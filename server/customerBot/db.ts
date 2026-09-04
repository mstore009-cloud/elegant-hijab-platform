import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import {
  customerBotRuns,
  customerBotSettings,
  customerBotUsageCounters,
  customerBotKnowledgeArticles,
  customerBotRunKnowledgeSources,
  channelAccounts,
  inboxConversations,
  inboxMessages,
  orders,
  productVariants,
  products,
  storeSettings,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { invokeLLM, type InvokeParams, type InvokeResult } from "../_core/llm";
import { notifyEmployee, notifyPermissionHolders } from "../notifications/db";
import { listCustomerImageFacts, type CustomerImageFacts } from "./imageAnalysis";
import { sendMetaConversationMessage } from "../channels/metaOutbound";

export const botModes = ["draft_only", "auto_reply"] as const;
export type BotMode = (typeof botModes)[number];

const orderStatusLabels: Record<string, string> = {
  new: "طلب جديد",
  needs_contact: "بحاجة إلى تواصل",
  confirmed: "تم تأكيد الطلب",
  preparing: "جارٍ تجهيز الطلب",
  out_for_delivery: "خرج للتوصيل",
  completed: "اكتمل الطلب",
  cancelled: "أُلغي الطلب",
};

const humanHandoffTerms = /(خصم|تخفيض|كوبون|إرجاع|ارجاع|استرجاع|إلغاء|الغاء|شكوى|مشكلة|تغيير.{0,24}(سعر|طلب|كمية|عنوان)|تعديل.{0,24}(سعر|طلب|كمية|عنوان)|فاتورة|استبدال)/i;
const complexConversationTerms = /(قارن|مقارنة|الأفضل|الافضل|أنسب|انسب|مناسبة|ستايل|تنسيق|أكثر من|اكثر من|بين .+ و)/i;

type LlmInvoker = (params: InvokeParams) => Promise<InvokeResult>;

export type BotFacts = {
  store: { currencyCode: string; defaultDeliveryFee: string; freeDeliveryEnabled: boolean; freeDeliveryThreshold: string | null };
  conversation: { id: number; subject: string | null; channel: string; customerName: string | null; order: { orderNumber: string; status: string; statusLabel: string; total: string } | null };
  products: Array<{ productCode: string; name: string; category: string; sellingPrice: string; description: string | null; colors: Array<{ colorName: string; sizes: Array<{ size: string | null; available: boolean }> }> }>;
  knowledge: Array<{ id: number; title: string; kind: string; body: string }>;
  recentMessages: Array<{ direction: "inbound" | "outbound"; body: string }>;
  imageAnalyses: CustomerImageFacts[];
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

function dateKey(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function responseText(result: InvokeResult) {
  const value = result.choices[0]?.message.content;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter(part => part.type === "text").map(part => part.text).join("\n");
  return "";
}

function extractTerms(value: string) {
  return Array.from(new Set(value.split(/[^A-Za-z0-9\u0600-\u06FF-]+/).map(term => term.trim()).filter(term => term.length >= 3))).slice(0, 6);
}

function shouldEscalateBeforeModel(message: string, productCount: number, recentMessageCount: number, imageAnalyses: CustomerImageFacts[]) {
  if (complexConversationTerms.test(message)) return "طلب مقارنة أو اختيار متعدد المعايير";
  if (productCount > 2) return "تطابق أكثر من منتجين مع سؤال العميل";
  if (recentMessageCount >= 6) return "حوار ممتد يحتاج تلخيصاً أعمق";
  return null;
}

function imageHandoffReason(imageAnalyses: CustomerImageFacts[]) {
  if (imageAnalyses.some(analysis => analysis.status === "failed")) return "تعذر تحليل صورة العميل ويحتاج الأمر إلى مراجعة موظف";
  if (imageAnalyses.some(analysis => analysis.status === "pending")) return "صورة العميل ما زالت قيد التجهيز وتحتاج مراجعة موظف";
  if (imageAnalyses.some(analysis => analysis.suitableForMatching && (analysis.confidence ?? 0) < 60)) return "ثقة تحليل صورة العميل أقل من الحد الآمن";
  if (imageAnalyses.some(analysis => analysis.status === "completed" && analysis.suitableForMatching && analysis.matches.length === 0)) return "لم يثبت تطابق صورة العميل مع منتج ويحتاج الأمر إلى مراجعة موظف";
  return null;
}

function parseStructuredReply(value: string) {
  try {
    const parsed = JSON.parse(value) as { reply?: unknown; confidence?: unknown; needsEscalation?: unknown; escalationReason?: unknown };
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim().slice(0, 1800) : "";
    const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : 0;
    return { reply, confidence, needsEscalation: parsed.needsEscalation === true, escalationReason: typeof parsed.escalationReason === "string" ? parsed.escalationReason.slice(0, 120) : null };
  } catch {
    return { reply: "", confidence: 0, needsEscalation: true, escalationReason: "تعذر التحقق من صيغة الرد" };
  }
}

async function getSettings(db: any, storeId: number) {
  const [settings] = await db.select().from(customerBotSettings).where(eq(customerBotSettings.storeId, storeId)).limit(1);
  if (settings) return settings;
  const result = await db.insert(customerBotSettings).values({ storeId });
  const [created] = await db.select().from(customerBotSettings).where(eq(customerBotSettings.id, Number(result[0].insertId))).limit(1);
  if (!created) throw new Error("تعذر تهيئة إعدادات بوت العملاء.");
  return created;
}

async function getScopedConversation(db: any, storeId: number, conversationId: number) {
  const [conversation] = await db.select().from(inboxConversations).where(and(eq(inboxConversations.id, conversationId), eq(inboxConversations.storeId, storeId))).limit(1);
  if (!conversation) throw new Error("المحادثة غير موجودة في المتجر التشغيلي الحالي.");
  return conversation;
}

async function reserveUsage(input: { db: any; storeId: number; kind: "fast" | "escalation"; limit: number }) {
  const usageDate = dateKey();
  return input.db.transaction(async (tx: any) => {
    await tx.insert(customerBotUsageCounters).values({ storeId: input.storeId, usageDate }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
    const [counter] = await tx.select().from(customerBotUsageCounters).where(and(eq(customerBotUsageCounters.storeId, input.storeId), eq(customerBotUsageCounters.usageDate, usageDate))).limit(1);
    const field = input.kind === "fast" ? customerBotUsageCounters.fastReplyCount : customerBotUsageCounters.escalationCount;
    const count = input.kind === "fast" ? counter.fastReplyCount : counter.escalationCount;
    if (count >= input.limit) return false;
    await tx.update(customerBotUsageCounters).set({ [input.kind === "fast" ? "fastReplyCount" : "escalationCount"]: sql`${field} + 1` }).where(eq(customerBotUsageCounters.id, counter.id));
    return true;
  });
}

async function collectFacts(db: any, storeId: number, conversationId: number, sourceBody: string, sourceMessageId: number): Promise<BotFacts> {
  const conversation = await getScopedConversation(db, storeId, conversationId);
  const [[store], messages] = await Promise.all([
    db.select({ currencyCode: storeSettings.currencyCode, defaultDeliveryFee: storeSettings.defaultDeliveryFee, freeDeliveryEnabled: storeSettings.freeDeliveryEnabled, freeDeliveryThreshold: storeSettings.freeDeliveryThreshold }).from(storeSettings).where(eq(storeSettings.storeId, storeId)).limit(1),
    db.select({ direction: inboxMessages.direction, body: inboxMessages.body }).from(inboxMessages).where(and(eq(inboxMessages.conversationId, conversation.id), or(eq(inboxMessages.direction, "inbound"), eq(inboxMessages.direction, "outbound"))!)).orderBy(desc(inboxMessages.occurredAt), desc(inboxMessages.id)).limit(6),
  ]);
  const terms = extractTerms(sourceBody);
  const productFilters = terms.flatMap(term => [like(products.name, `%${term}%`), like(products.productCode, `%${term}%`), like(products.category, `%${term}%`)]);
  const knowledgeFilters = terms.flatMap(term => [like(customerBotKnowledgeArticles.title, `%${term}%`), like(customerBotKnowledgeArticles.body, `%${term}%`)]);
  type SafeProduct = { id: number; productCode: string; name: string; category: string; sellingPrice: string; description: string | null };
  type SafeVariant = { productId: number; colorName: string; sizeLabel: string; inventoryQuantity: number; availability: "available" | "low_stock" | "out_of_stock" };
  const matchingProducts: SafeProduct[] = productFilters.length
    ? await db.select({ id: products.id, productCode: products.productCode, name: products.name, category: products.category, sellingPrice: products.sellingPrice, description: products.description }).from(products).where(and(eq(products.storeId, storeId), eq(products.status, "active"), or(...productFilters)!)).orderBy(desc(products.updatedAt)).limit(5)
    : [];
  const variants: SafeVariant[] = matchingProducts.length
    ? await db.select({ productId: productVariants.productId, colorName: productVariants.colorName, sizeLabel: productVariants.sizeLabel, inventoryQuantity: productVariants.inventoryQuantity, availability: productVariants.availability }).from(productVariants).where(inArray(productVariants.productId, matchingProducts.map(product => product.id)))
    : [];
  const approvedKnowledge: Array<{ id: number; title: string; kind: string; body: string }> = knowledgeFilters.length
    ? await db.select({ id: customerBotKnowledgeArticles.id, title: customerBotKnowledgeArticles.title, kind: customerBotKnowledgeArticles.kind, body: customerBotKnowledgeArticles.body }).from(customerBotKnowledgeArticles).where(and(eq(customerBotKnowledgeArticles.storeId, storeId), eq(customerBotKnowledgeArticles.status, "approved"), or(...knowledgeFilters)!)).orderBy(desc(customerBotKnowledgeArticles.updatedAt)).limit(5)
    : [];
  const [linkedOrder] = conversation.orderId
    ? await db.select({ orderNumber: orders.orderNumber, status: orders.status, total: orders.total }).from(orders).where(and(eq(orders.storeId, storeId), eq(orders.id, conversation.orderId))).limit(1)
    : [];
  const imageAnalyses = await listCustomerImageFacts(storeId, sourceMessageId);
  return {
    store: { currencyCode: store?.currencyCode ?? "IQD", defaultDeliveryFee: store?.defaultDeliveryFee ?? "0.00", freeDeliveryEnabled: store?.freeDeliveryEnabled ?? false, freeDeliveryThreshold: store?.freeDeliveryThreshold ?? null },
    conversation: { id: conversation.id, subject: conversation.subject, channel: conversation.channel, customerName: conversation.contactNameSnapshot, order: linkedOrder ? { ...linkedOrder, statusLabel: orderStatusLabels[linkedOrder.status] ?? linkedOrder.status } : null },
    products: matchingProducts.map(product => {
      const colorGroups = new Map<string, { colorName: string; sizes: Array<{ size: string | null; available: boolean }> }>();
      variants.filter(variant => variant.productId === product.id).forEach(variant => {
        if (!colorGroups.has(variant.colorName)) colorGroups.set(variant.colorName, { colorName: variant.colorName, sizes: [] });
        colorGroups.get(variant.colorName)!.sizes.push({ size: variant.sizeLabel || null, available: variant.inventoryQuantity > 0 && variant.availability !== "out_of_stock" });
      });
      return { ...product, colors: Array.from(colorGroups.values()) };
    }),
    knowledge: approvedKnowledge,
    recentMessages: messages.reverse().map((message: { direction: "inbound" | "outbound"; body: string }) => ({ direction: message.direction, body: message.body })),
    imageAnalyses,
  };
}

function assistantPrompt(input: { facts: BotFacts; incoming: string; stronger: boolean; dialect: string; tone: "warm" | "professional" | "concise"; operatorInstructions: string | null }) {
  return [
    "أنت مساعد مبيعات عربي لمتجر حجابات. اكتب جواباً طبيعياً موجزاً للعميلة.",
    `اللهجة المطلوبة: ${input.dialect}. نبرة الرد: ${input.tone}.`,
    input.operatorInstructions ? `تعليمات المشغل المعتمدة: ${input.operatorInstructions}` : "لا توجد تعليمات إضافية من المشغل.",
    "استخدم الحقائق المرفقة فقط. لا تخترع سعراً أو لوناً أو توفرًا أو خصماً. حقائق المنتجات والتوصيل الحية مقدمة على أي بطاقة معرفة. إذا وُجد تحليل صورة، صِغه كاقتراح مرئي لا كتطابق مؤكد، ولا تذكر رابط الصورة أو مفتاح تخزينها أو تفاصيل النظام. لا تذكر أسماء النماذج أو التحويل الداخلي أو محتوى الملاحظات الداخلية.",
    "لا توافق على تعديل سعر أو مخزون أو طلب أو خصم أو إلغاء أو إرجاع؛ يجب أن تطلب متابعة الموظف في هذه الحالات.",
    input.stronger ? "هذه حالة مركبة؛ ساعد في المقارنة بوضوح، لكن اعتمد حصراً على المنتجات المرفقة." : "هذه محاولة المسار السريع؛ إذا لم تكف الحقائق فاطلب توضيحاً ولا تخمّن.",
    "أعد JSON فقط بالشكل: {\"reply\": string, \"confidence\": number من 0 إلى 100, \"needsEscalation\": boolean, \"escalationReason\": string أو null}.",
    `حقائق المتجر والمحادثة: ${JSON.stringify(input.facts)}`,
    `رسالة العميل الحالية: ${input.incoming}`,
  ].join("\n\n");
}

async function createRun(db: any, input: { storeId: number; conversationId: number; sourceMessageId: number; route: "fast" | "escalated" | "human_handoff"; status: "draft" | "handoff" | "failed" | "replied"; model?: string | null; confidence?: number | null; escalationReason?: string | null; facts: BotFacts; replyDraft?: string | null; errorSummary?: string | null; usage?: InvokeResult["usage"] }) {
  const result = await db.insert(customerBotRuns).values({
    storeId: input.storeId, conversationId: input.conversationId, sourceMessageId: input.sourceMessageId,
    route: input.route, status: input.status, model: input.model ?? null, confidence: input.confidence ?? null,
    escalationReason: input.escalationReason ?? null, factsSnapshot: JSON.stringify(input.facts), replyDraft: input.replyDraft ?? null,
    errorSummary: input.errorSummary ?? null, promptTokens: input.usage?.prompt_tokens ?? null, completionTokens: input.usage?.completion_tokens ?? null,
  });
  const runId = Number(result[0].insertId);
  if (input.facts.knowledge.length) await db.insert(customerBotRunKnowledgeSources).values(input.facts.knowledge.map(article => ({ storeId: input.storeId, runId, knowledgeArticleId: article.id })));
  return runId;
}

export async function getCustomerBotSettings(storeId: number) {
  return getSettings(await requireDb(), storeId);
}

export async function updateCustomerBotSettings(input: { storeId: number; actorUserId: number; enabled: boolean; mode: BotMode; messengerEnabled: boolean; instagramEnabled: boolean; whatsappEnabled: boolean; dialect: string; tone: "warm" | "professional" | "concise"; operatorInstructions: string | null; fastModel: string; escalationModel: string; minimumConfidence: number; maxDailyReplies: number; maxDailyEscalations: number }) {
  const db = await requireDb();
  await getSettings(db, input.storeId);
  await db.update(customerBotSettings).set({
    enabled: input.enabled,
    mode: input.mode,
    messengerEnabled: input.messengerEnabled,
    instagramEnabled: input.instagramEnabled,
    whatsappEnabled: input.whatsappEnabled,
    dialect: input.dialect,
    tone: input.tone,
    operatorInstructions: input.operatorInstructions,
    fastModel: input.fastModel,
    escalationModel: input.escalationModel,
    minimumConfidence: input.minimumConfidence,
    maxDailyReplies: input.maxDailyReplies,
    maxDailyEscalations: input.maxDailyEscalations,
    updatedByUserId: input.actorUserId,
  }).where(eq(customerBotSettings.storeId, input.storeId));
  return getSettings(db, input.storeId);
}

export async function listCustomerBotRuns(storeId: number, conversationId: number) {
  const db = await requireDb();
  await getScopedConversation(db, storeId, conversationId);
  return db.select().from(customerBotRuns).where(and(eq(customerBotRuns.storeId, storeId), eq(customerBotRuns.conversationId, conversationId))).orderBy(desc(customerBotRuns.createdAt), desc(customerBotRuns.id));
}

export async function dismissCustomerBotRun(input: { storeId: number; conversationId: number; runId: number }) {
  const db = await requireDb();
  await getScopedConversation(db, input.storeId, input.conversationId);
  const [run] = await db.select().from(customerBotRuns).where(and(eq(customerBotRuns.id, input.runId), eq(customerBotRuns.storeId, input.storeId), eq(customerBotRuns.conversationId, input.conversationId))).limit(1);
  if (!run) throw new Error("مسودة البوت غير موجودة في المحادثة الحالية.");
  await db.update(customerBotRuns).set({ status: "dismissed" }).where(eq(customerBotRuns.id, run.id));
}

function channelIsEnabled(settings: any, channel: string) {
  return channel === "messenger" ? settings.messengerEnabled : channel === "instagram" ? settings.instagramEnabled : channel === "whatsapp" ? settings.whatsappEnabled : false;
}

async function maybeSendAutomaticReply(input: { db: any; settings: any; storeId: number; conversation: any; runId: number; body: string; confidence: number; actorUserId?: number | null; route: "fast" | "escalated" }) {
  if (input.settings.mode !== "auto_reply" || !input.settings.enabled || !channelIsEnabled(input.settings, input.conversation.channel)) return { status: "draft" as const, sent: false as const };
  try {
    await sendMetaConversationMessage({ storeId: input.storeId, conversationId: input.conversation.id, body: input.body, idempotencyKey: `bot:${input.runId}`, mode: "bot_guarded", actorUserId: input.actorUserId ?? null, botRunId: input.runId });
    await input.db.update(customerBotRuns).set({ status: "replied" }).where(and(eq(customerBotRuns.id, input.runId), eq(customerBotRuns.storeId, input.storeId)));
    return { status: "replied" as const, sent: true as const };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "تعذر إرسال رد البوت عبر القناة الرسمية.";
    await input.db.update(customerBotRuns).set({ status: "failed", errorSummary: reason.slice(0, 500) }).where(and(eq(customerBotRuns.id, input.runId), eq(customerBotRuns.storeId, input.storeId)));
    await notifyHumanHandoffSafely({ storeId: input.storeId, conversation: input.conversation, reason: `فشل إرسال رد البوت عبر ${input.conversation.channel}: ${reason}` });
    return { status: "failed" as const, sent: false as const, error: reason };
  }
}

async function notifyHumanHandoffSafely(input: { storeId: number; conversation: any; reason: string }) {
  const notification = {
    storeId: input.storeId,
    type: "bot_handoff" as const,
    priority: "urgent" as const,
    title: `البوت يحتاج تدخلاً بشرياً: ${input.conversation.contactNameSnapshot}`,
    body: input.reason.slice(0, 1000),
    entityType: "inbox_conversation",
    entityId: input.conversation.id,
    route: `/inbox?conversation=${input.conversation.id}`,
  };
  try {
    if (input.conversation.assignedEmployeeId) {
      await notifyEmployee({ ...notification, employeeId: input.conversation.assignedEmployeeId });
    } else {
      await notifyPermissionHolders({ ...notification, permissionCode: "inbox.takeover" });
    }
  } catch (error) {
    console.warn("[Notifications] تعذر إنشاء تنبيه تحويل البوت:", error);
  }
}

export async function generateCustomerBotDraft(input: { storeId: number; actorUserId?: number | null; conversationId: number; sourceMessageId?: number; llm?: LlmInvoker }) {
  const db = await requireDb();
  const settings = await getSettings(db, input.storeId);
  if (!settings.enabled) throw new Error("بوت العملاء غير مفعّل. فعّله أولاً من مركز البوت.");
  const conversation = await getScopedConversation(db, input.storeId, input.conversationId);
  const [sourceMessage] = input.sourceMessageId
    ? await db.select().from(inboxMessages).where(and(eq(inboxMessages.id, input.sourceMessageId), eq(inboxMessages.conversationId, conversation.id), eq(inboxMessages.direction, "inbound"))).limit(1)
    : await db.select().from(inboxMessages).where(and(eq(inboxMessages.conversationId, conversation.id), eq(inboxMessages.direction, "inbound"))).orderBy(desc(inboxMessages.occurredAt), desc(inboxMessages.id)).limit(1);
  if (!sourceMessage) throw new Error("لا توجد رسالة عميل واردة صالحة لإنشاء مسودة رد.");
  if (sourceMessage.source === "historical_sync") throw new Error("لا يشغّل Bot-H3 الرسائل التاريخية؛ استخدمي مسار المرشحات والمراجعة أولاً.");
  const facts = await collectFacts(db, input.storeId, conversation.id, sourceMessage.body, sourceMessage.id);
  const immediateHandoff = humanHandoffTerms.test(sourceMessage.body);
  const imageReason = imageHandoffReason(facts.imageAnalyses);
  if (immediateHandoff || imageReason) {
    const reason = immediateHandoff ? "طلب حساس يحتاج موظفاً مخولاً" : imageReason!;
    const runId = await createRun(db, { storeId: input.storeId, conversationId: conversation.id, sourceMessageId: sourceMessage.id, route: "human_handoff", status: "handoff", escalationReason: reason, facts });
    await db.update(inboxConversations).set({ priority: true, status: "open", snoozedUntil: null, closedAt: null }).where(eq(inboxConversations.id, conversation.id));
    await notifyHumanHandoffSafely({ storeId: input.storeId, conversation, reason });
    return { runId, route: "human_handoff" as const, status: "handoff" as const, replyDraft: null, confidence: null, escalationReason: reason };
  }
  const llm = input.llm ?? invokeLLM;
  const preEscalationReason = shouldEscalateBeforeModel(sourceMessage.body, facts.products.length, facts.recentMessages.length, facts.imageAnalyses);
  const fastReserved = await reserveUsage({ db, storeId: input.storeId, kind: "fast", limit: settings.maxDailyReplies });
  if (!fastReserved) {
    const runId = await createRun(db, { storeId: input.storeId, conversationId: conversation.id, sourceMessageId: sourceMessage.id, route: "human_handoff", status: "handoff", escalationReason: "تجاوز حد الردود اليومية للمسار السريع", facts });
    await notifyHumanHandoffSafely({ storeId: input.storeId, conversation, reason: "تجاوز حد الردود اليومية للمسار السريع" });
    return { runId, route: "human_handoff" as const, status: "handoff" as const, replyDraft: null, confidence: null, escalationReason: "تجاوز حد الردود اليومية للمسار السريع" };
  }
  try {
    if (!preEscalationReason) {
              const fastResult = await llm({ model: settings.fastModel, messages: [{ role: "system", content: assistantPrompt({ facts, incoming: sourceMessage.body, stronger: false, dialect: settings.dialect, tone: settings.tone, operatorInstructions: settings.operatorInstructions }) }], outputSchema: { name: "customer_assistant_reply", strict: true, schema: { type: "object", properties: { reply: { type: "string" }, confidence: { type: "integer" }, needsEscalation: { type: "boolean" }, escalationReason: { type: ["string", "null"] } }, required: ["reply", "confidence", "needsEscalation", "escalationReason"], additionalProperties: false } } });
      const parsed = parseStructuredReply(responseText(fastResult));
      if (!parsed.needsEscalation && parsed.confidence >= settings.minimumConfidence && parsed.reply) {
        const runId = await createRun(db, { storeId: input.storeId, conversationId: conversation.id, sourceMessageId: sourceMessage.id, route: "fast", status: "draft", model: settings.fastModel, confidence: parsed.confidence, facts, replyDraft: parsed.reply, usage: fastResult.usage });
        const delivery = await maybeSendAutomaticReply({ db, settings, storeId: input.storeId, conversation, runId, body: parsed.reply, confidence: parsed.confidence, actorUserId: input.actorUserId, route: "fast" });
        return { runId, route: "fast" as const, status: delivery.status, replyDraft: parsed.reply, confidence: parsed.confidence, escalationReason: delivery.error ?? null };
      }
      return generateEscalatedDraft({ db, settings, facts, sourceMessage, conversationId: conversation.id, storeId: input.storeId, llm, reason: parsed.escalationReason || "ثقة المسار السريع أقل من الحد" });
    }
    return generateEscalatedDraft({ db, settings, facts, sourceMessage, conversationId: conversation.id, storeId: input.storeId, llm, reason: preEscalationReason });
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر إنشاء المسودة.";
    const runId = await createRun(db, { storeId: input.storeId, conversationId: conversation.id, sourceMessageId: sourceMessage.id, route: preEscalationReason ? "escalated" : "fast", status: "failed", model: preEscalationReason ? settings.escalationModel : settings.fastModel, facts, errorSummary: message.slice(0, 500) });
    return { runId, route: preEscalationReason ? "escalated" as const : "fast" as const, status: "failed" as const, replyDraft: null, confidence: null, escalationReason: message.slice(0, 120) };
  }
}

async function generateEscalatedDraft(input: { db: any; settings: any; facts: BotFacts; sourceMessage: any; conversationId: number; storeId: number; llm: LlmInvoker; reason: string }) {
  const reserved = await reserveUsage({ db: input.db, storeId: input.storeId, kind: "escalation", limit: input.settings.maxDailyEscalations });
  if (!reserved) {
    const runId = await createRun(input.db, { storeId: input.storeId, conversationId: input.conversationId, sourceMessageId: input.sourceMessage.id, route: "human_handoff", status: "handoff", escalationReason: "تجاوز حد التصعيد اليومي", facts: input.facts });
    const conversation = await getScopedConversation(input.db, input.storeId, input.conversationId);
    await notifyHumanHandoffSafely({ storeId: input.storeId, conversation, reason: "تجاوز حد التصعيد اليومي" });
    return { runId, route: "human_handoff" as const, status: "handoff" as const, replyDraft: null, confidence: null, escalationReason: "تجاوز حد التصعيد اليومي" };
  }
  const result = await input.llm({ model: input.settings.escalationModel, messages: [{ role: "system", content: assistantPrompt({ facts: input.facts, incoming: input.sourceMessage.body, stronger: true, dialect: input.settings.dialect, tone: input.settings.tone, operatorInstructions: input.settings.operatorInstructions }) }], outputSchema: { name: "customer_assistant_escalated_reply", strict: true, schema: { type: "object", properties: { reply: { type: "string" }, confidence: { type: "integer" }, needsEscalation: { type: "boolean" }, escalationReason: { type: ["string", "null"] } }, required: ["reply", "confidence", "needsEscalation", "escalationReason"], additionalProperties: false } } });
  const parsed = parseStructuredReply(responseText(result));
  if (parsed.needsEscalation || parsed.confidence < input.settings.minimumConfidence || !parsed.reply) {
    const runId = await createRun(input.db, { storeId: input.storeId, conversationId: input.conversationId, sourceMessageId: input.sourceMessage.id, route: "human_handoff", status: "handoff", model: input.settings.escalationModel, confidence: parsed.confidence, escalationReason: parsed.escalationReason || input.reason, facts: input.facts, usage: result.usage });
    const conversation = await getScopedConversation(input.db, input.storeId, input.conversationId);
    await notifyHumanHandoffSafely({ storeId: input.storeId, conversation, reason: parsed.escalationReason || input.reason });
    return { runId, route: "human_handoff" as const, status: "handoff" as const, replyDraft: null, confidence: parsed.confidence, escalationReason: parsed.escalationReason || input.reason };
  }
  const runId = await createRun(input.db, { storeId: input.storeId, conversationId: input.conversationId, sourceMessageId: input.sourceMessage.id, route: "escalated", status: "draft", model: input.settings.escalationModel, confidence: parsed.confidence, escalationReason: input.reason, facts: input.facts, replyDraft: parsed.reply, usage: result.usage });
  const conversation = await getScopedConversation(input.db, input.storeId, input.conversationId);
  const delivery = await maybeSendAutomaticReply({ db: input.db, settings: input.settings, storeId: input.storeId, conversation, runId, body: parsed.reply, confidence: parsed.confidence, route: "escalated" });
  return { runId, route: "escalated" as const, status: delivery.status, replyDraft: parsed.reply, confidence: parsed.confidence, escalationReason: delivery.error ?? input.reason };
}
