import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import {
  customerBotRuns,
  customerBotSettings,
  customerBotUsageCounters,
  customerBotKnowledgeArticles,
  customerBotBehaviorCards,
  customerBotPlaybooks,
  customerBotRunKnowledgeSources,
  channelAccounts,
  inboxConversations,
  inboxMessages,
  orders,
  productVariants,
  products,
  productMedia,
  metaCatalogProductEnrichments,
  storeSettings,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { InvokeParams, InvokeResult } from "../_core/llm";
import { notifyEmployee, notifyPermissionHolders } from "../notifications/db";
import { listCustomerImageFacts, type CustomerImageFacts } from "./imageAnalysis";
import { sendMetaCommentReply, sendMetaDirectMessage } from "../channels/metaOutbound";
import { createAiTaskInvoker } from "../ai/taskInvoker";
import { absoluteMetaCatalogStorageUrl } from "../integrations/meta/catalogExportDb";
import { createCustomerBotOrderDraft } from "./orderDrafts";

export const botModes = ["draft_only", "auto_reply"] as const;
export type BotMode = (typeof botModes)[number];

export const botActionTypes = ["none", "send_product_images", "send_product_card", "order_summary", "notify_human"] as const;
export type BotActionType = (typeof botActionTypes)[number];
export type BotActionDecision = { type: BotActionType; productCode: string | null; colorName: string | null; quantity: number | null; caption: string | null; reason: string | null };

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
  products: Array<{ productCode: string; name: string; category: string; sellingPrice: string; description: string | null; productLink: string | null; imageUrls: string[]; colors: Array<{ colorName: string; imageUrls: string[]; sizes: Array<{ size: string | null; available: boolean }> }> }>;
  knowledge: Array<{ id: number; title: string; kind: string; body: string }>;
  behaviorCards: Array<{ id: number; title: string; kind: string; body: string; priority: number }>;
  playbooks: Array<{ id: number; title: string; triggerJson: string; stepsJson: string; guardrailsJson: string | null }>;
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
    const parsed = JSON.parse(value) as { reply?: unknown; confidence?: unknown; needsEscalation?: unknown; escalationReason?: unknown; action?: unknown; productCode?: unknown; colorName?: unknown; quantity?: unknown; actionCaption?: unknown };
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim().slice(0, 1800) : "";
    const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : 0;
    const action = typeof parsed.action === "string" && (botActionTypes as readonly string[]).includes(parsed.action) ? parsed.action as BotActionType : "none";
    return { reply, confidence, needsEscalation: parsed.needsEscalation === true, escalationReason: typeof parsed.escalationReason === "string" ? parsed.escalationReason.slice(0, 120) : null, action: { type: action, productCode: typeof parsed.productCode === "string" ? parsed.productCode.trim().slice(0, 80) : null, colorName: typeof parsed.colorName === "string" ? parsed.colorName.trim().slice(0, 100) : null, quantity: typeof parsed.quantity === "number" && Number.isFinite(parsed.quantity) ? Math.min(20, Math.max(1, Math.round(parsed.quantity))) : null, caption: typeof parsed.actionCaption === "string" ? parsed.actionCaption.trim().slice(0, 500) : null, reason: typeof parsed.escalationReason === "string" ? parsed.escalationReason.slice(0, 120) : null } satisfies BotActionDecision };
  } catch {
    return { reply: "", confidence: 0, needsEscalation: true, escalationReason: "تعذر التحقق من صيغة الرد", action: { type: "notify_human" as const, productCode: null, colorName: null, quantity: null, caption: null, reason: "تعذر التحقق من صيغة الرد" } };
  }
}

function applyProductResponsePolicy(action: BotActionDecision, settings: any, facts: BotFacts): BotActionDecision {
  if (action.type !== "send_product_images" && action.type !== "send_product_card") return action;
  const product = action.productCode ? facts.products.find(item => item.productCode === action.productCode) : facts.products[0];
  if (!product) return { ...action, type: "none", reason: "لا يوجد منتج حي مطابق لقرار الإجراء" };
  if (settings.productResponseMode === "ask_first") return { ...action, type: "none", productCode: product.productCode, reason: "إعداد المتجر يطلب سؤال العميل قبل إرسال الوسائط" };
  if (settings.productResponseMode === "images") return { ...action, type: "send_product_images", productCode: product.productCode };
  if (settings.productResponseMode === "product_card") return { ...action, type: "send_product_card", productCode: product.productCode };
  if (action.type === "send_product_images" && !product.imageUrls.length) return { ...action, type: product.productLink ? "send_product_card" : "none", productCode: product.productCode, reason: "لا توجد صورة تشغيلية متاحة؛ استُخدم البديل الآمن" };
  if (action.type === "send_product_card" && !product.productLink) return { ...action, type: product.imageUrls.length ? "send_product_images" : "none", productCode: product.productCode, reason: "لا يوجد رابط منتج؛ استُخدم البديل الآمن" };
  return { ...action, productCode: product.productCode };
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
  const imageAnalyses = await listCustomerImageFacts(storeId, sourceMessageId);
  const imageProductCodes = Array.from(new Set(imageAnalyses.flatMap(analysis => analysis.matches.map(match => match.productCode))));
  const productFilters = [...imageProductCodes.map(code => eq(products.productCode, code)), ...terms.flatMap(term => [like(products.name, `%${term}%`), like(products.productCode, `%${term}%`), like(products.category, `%${term}%`)])];
  const knowledgeFilters = terms.flatMap(term => [like(customerBotKnowledgeArticles.title, `%${term}%`), like(customerBotKnowledgeArticles.body, `%${term}%`)]);
  type SafeProduct = { id: number; productCode: string; name: string; category: string; sellingPrice: string; description: string | null };
  type SafeVariant = { id: number; productId: number; colorName: string; sizeLabel: string; inventoryQuantity: number; availability: "available" | "low_stock" | "out_of_stock" };
  const matchingProducts: SafeProduct[] = productFilters.length
    ? await db.select({ id: products.id, productCode: products.productCode, name: products.name, category: products.category, sellingPrice: products.sellingPrice, description: products.description }).from(products).where(and(eq(products.storeId, storeId), eq(products.status, "active"), or(...productFilters)!)).orderBy(desc(products.updatedAt)).limit(5)
    : [];
  const variants: SafeVariant[] = matchingProducts.length
    ? await db.select({ id: productVariants.id, productId: productVariants.productId, colorName: productVariants.colorName, sizeLabel: productVariants.sizeLabel, inventoryQuantity: productVariants.inventoryQuantity, availability: productVariants.availability }).from(productVariants).where(inArray(productVariants.productId, matchingProducts.map(product => product.id)))
    : [];
  const approvedKnowledge: Array<{ id: number; title: string; kind: string; body: string }> = knowledgeFilters.length
    ? await db.select({ id: customerBotKnowledgeArticles.id, title: customerBotKnowledgeArticles.title, kind: customerBotKnowledgeArticles.kind, body: customerBotKnowledgeArticles.body }).from(customerBotKnowledgeArticles).where(and(eq(customerBotKnowledgeArticles.storeId, storeId), eq(customerBotKnowledgeArticles.status, "approved"), or(...knowledgeFilters)!)).orderBy(desc(customerBotKnowledgeArticles.updatedAt)).limit(5)
    : await db.select({ id: customerBotKnowledgeArticles.id, title: customerBotKnowledgeArticles.title, kind: customerBotKnowledgeArticles.kind, body: customerBotKnowledgeArticles.body }).from(customerBotKnowledgeArticles).where(and(eq(customerBotKnowledgeArticles.storeId, storeId), eq(customerBotKnowledgeArticles.status, "approved"))).orderBy(desc(customerBotKnowledgeArticles.updatedAt)).limit(3);
  const mediaData = matchingProducts.length
    ? await Promise.all([
      db.select({ productId: productMedia.productId, variantId: productMedia.variantId, storageKey: productMedia.storageKey, mediaType: productMedia.mediaType, sortOrder: productMedia.sortOrder }).from(productMedia).where(and(inArray(productMedia.productId, matchingProducts.map(product => product.id)), eq(productMedia.mediaType, "image"))).orderBy(productMedia.sortOrder),
      db.select({ productId: metaCatalogProductEnrichments.productId, productLink: metaCatalogProductEnrichments.productLink }).from(metaCatalogProductEnrichments).where(and(eq(metaCatalogProductEnrichments.storeId, storeId), inArray(metaCatalogProductEnrichments.productId, matchingProducts.map(product => product.id)))),
    ])
    : [[], []];
  const [mediaRows, enrichmentRows] = mediaData;
  const [behaviorCards, playbooks] = await Promise.all([
    db.select({ id: customerBotBehaviorCards.id, title: customerBotBehaviorCards.title, kind: customerBotBehaviorCards.kind, body: customerBotBehaviorCards.body, priority: customerBotBehaviorCards.priority }).from(customerBotBehaviorCards).where(and(eq(customerBotBehaviorCards.storeId, storeId), eq(customerBotBehaviorCards.status, "approved"))).orderBy(customerBotBehaviorCards.priority).limit(12),
    db.select({ id: customerBotPlaybooks.id, title: customerBotPlaybooks.title, triggerJson: customerBotPlaybooks.triggerJson, stepsJson: customerBotPlaybooks.stepsJson, guardrailsJson: customerBotPlaybooks.guardrailsJson }).from(customerBotPlaybooks).where(and(eq(customerBotPlaybooks.storeId, storeId), eq(customerBotPlaybooks.status, "approved"))).orderBy(desc(customerBotPlaybooks.updatedAt)).limit(8),
  ]);
  const [linkedOrder] = conversation.orderId
    ? await db.select({ orderNumber: orders.orderNumber, status: orders.status, total: orders.total }).from(orders).where(and(eq(orders.storeId, storeId), eq(orders.id, conversation.orderId))).limit(1)
    : [];
  const enrichedProducts = await Promise.all(matchingProducts.map(async product => {
      const colorGroups = new Map<string, { colorName: string; imageUrls: string[]; sizes: Array<{ size: string | null; available: boolean }> }>();
      variants.filter(variant => variant.productId === product.id).forEach(variant => {
        if (!colorGroups.has(variant.colorName)) colorGroups.set(variant.colorName, { colorName: variant.colorName, imageUrls: [], sizes: [] });
        colorGroups.get(variant.colorName)!.sizes.push({ size: variant.sizeLabel || null, available: variant.inventoryQuantity > 0 && variant.availability !== "out_of_stock" });
      });
      const productMediaRows = mediaRows.filter((media: any) => media.productId === product.id).slice(0, 4);
      const imageUrls = (await Promise.all(productMediaRows.map((media: any) => absoluteMetaCatalogStorageUrl(media.storageKey)))).filter((url: string | null): url is string => Boolean(url));
      for (const media of productMediaRows) {
        const variant = variants.find(candidate => candidate.id === media.variantId);
        const target = variant ? colorGroups.get(variant.colorName) : null;
        const url = await absoluteMetaCatalogStorageUrl(media.storageKey);
        if (target && url) target.imageUrls.push(url);
      }
      return { ...product, productLink: enrichmentRows.find((row: any) => row.productId === product.id)?.productLink ?? null, imageUrls, colors: Array.from(colorGroups.values()) };
    }));
  return {
    store: { currencyCode: store?.currencyCode ?? "IQD", defaultDeliveryFee: store?.defaultDeliveryFee ?? "0.00", freeDeliveryEnabled: store?.freeDeliveryEnabled ?? false, freeDeliveryThreshold: store?.freeDeliveryThreshold ?? null },
    conversation: { id: conversation.id, subject: conversation.subject, channel: conversation.channel, customerName: conversation.contactNameSnapshot, order: linkedOrder ? { ...linkedOrder, statusLabel: orderStatusLabels[linkedOrder.status] ?? linkedOrder.status } : null },
    products: enrichedProducts,
    knowledge: approvedKnowledge,
    behaviorCards,
    playbooks,
    recentMessages: messages.reverse().map((message: { direction: "inbound" | "outbound"; body: string }) => ({ direction: message.direction, body: message.body })),
    imageAnalyses,
  };
}

function assistantPrompt(input: { facts: BotFacts; incoming: string; stronger: boolean; dialect: string; tone: "warm" | "professional" | "concise"; operatorInstructions: string | null; templates?: Record<string, string | null>; productResponseMode?: string }) {
  return [
    "أنت مساعد مبيعات عربي لمتجر حجابات. اكتب جواباً طبيعياً موجزاً للعميلة.",
    `اللهجة المطلوبة: ${input.dialect}. نبرة الرد: ${input.tone}.`,
    input.operatorInstructions ? `تعليمات المشغل المعتمدة: ${input.operatorInstructions}` : "لا توجد تعليمات إضافية من المشغل.",
    `قواعد عرض المنتج من الواجهة: ${input.productResponseMode ?? "smart"}. القوالب الاختيارية: ${JSON.stringify(input.templates ?? {})}. استخدم القالب كمرجع نبرة فقط، ولا تستبدل الحقائق الحية به.`,
    "استخدم الحقائق المرفقة فقط. لا تخترع سعراً أو لوناً أو توفرًا أو خصماً. حقائق المنتجات والتوصيل الحية مقدمة على أي بطاقة معرفة. إذا وُجد تحليل صورة، صِغه كاقتراح مرئي لا كتطابق مؤكد، ولا تذكر رابط الصورة أو مفتاح تخزينها أو تفاصيل النظام. لا تذكر أسماء النماذج أو التحويل الداخلي أو محتوى الملاحظات الداخلية.",
    "لا توافق على تعديل سعر أو مخزون أو طلب أو خصم أو إلغاء أو إرجاع؛ يجب أن تطلب متابعة الموظف في هذه الحالات.",
    input.stronger ? "هذه حالة مركبة؛ ساعد في المقارنة بوضوح، لكن اعتمد حصراً على المنتجات المرفقة." : "هذه محاولة المسار السريع؛ إذا لم تكف الحقائق فاطلب توضيحاً ولا تخمّن.",
    "اختر إجراءً واحداً فقط عند الحاجة: none أو send_product_images أو send_product_card أو order_summary أو notify_human. لا تستخدم order_summary إلا إذا كانت بيانات الطلب مكتملة في الحقائق. لا تستخدم notify_human للحالات الحساسة فقط؛ استخدمه عندما تحتاج الحالة فعلاً تدخلاً. أعد JSON فقط بالشكل: {\"reply\": string, \"confidence\": number من 0 إلى 100, \"needsEscalation\": boolean, \"escalationReason\": string أو null, \"action\": string, \"productCode\": string أو null, \"colorName\": string أو null, \"quantity\": number أو null, \"actionCaption\": string أو null}.",
    `حقائق المتجر والمحادثة: ${JSON.stringify(input.facts)}`,
    `رسالة العميل الحالية: ${input.incoming}`,
  ].join("\n\n");
}

async function createRun(db: any, input: { storeId: number; conversationId: number; sourceMessageId: number; route: "fast" | "escalated" | "human_handoff"; status: "draft" | "handoff" | "failed" | "replied"; model?: string | null; confidence?: number | null; escalationReason?: string | null; facts: BotFacts; replyDraft?: string | null; action?: BotActionDecision | null; errorSummary?: string | null; usage?: InvokeResult["usage"] }) {
  const result = await db.insert(customerBotRuns).values({
    storeId: input.storeId, conversationId: input.conversationId, sourceMessageId: input.sourceMessageId,
    route: input.route, status: input.status, model: input.model ?? null, confidence: input.confidence ?? null,
    escalationReason: input.escalationReason ?? null, factsSnapshot: JSON.stringify(input.facts), replyDraft: input.replyDraft ?? null, actionDecisionJson: input.action ? JSON.stringify(input.action) : null,
    errorSummary: input.errorSummary ?? null, promptTokens: input.usage?.prompt_tokens ?? null, completionTokens: input.usage?.completion_tokens ?? null,
  });
  const runId = Number(result[0].insertId);
  if (input.facts.knowledge.length) await db.insert(customerBotRunKnowledgeSources).values(input.facts.knowledge.map(article => ({ storeId: input.storeId, runId, knowledgeArticleId: article.id })));
  return runId;
}

export async function getCustomerBotSettings(storeId: number) {
  return getSettings(await requireDb(), storeId);
}

export async function updateCustomerBotSettings(input: { storeId: number; actorUserId: number; enabled: boolean; mode: BotMode; messengerEnabled: boolean; instagramEnabled: boolean; whatsappEnabled: boolean; dialect: string; tone: "warm" | "professional" | "concise"; operatorInstructions: string | null; welcomeTemplate?: string | null; priceReplyTemplate?: string | null; colorOfferTemplate?: string | null; productCardTemplate?: string | null; orderSummaryTemplate?: string | null; confirmationTemplate?: string | null; humanWaitingTemplate?: string | null; productResponseMode?: "smart" | "images" | "product_card" | "ask_first"; learningEnabled?: boolean; learningReviewDays?: number; fastModel: string; escalationModel: string; minimumConfidence: number; maxDailyReplies: number; maxDailyEscalations: number }) {
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
    welcomeTemplate: input.welcomeTemplate ?? null,
    priceReplyTemplate: input.priceReplyTemplate ?? null,
    colorOfferTemplate: input.colorOfferTemplate ?? null,
    productCardTemplate: input.productCardTemplate ?? null,
    orderSummaryTemplate: input.orderSummaryTemplate ?? null,
    confirmationTemplate: input.confirmationTemplate ?? null,
    humanWaitingTemplate: input.humanWaitingTemplate ?? null,
    productResponseMode: input.productResponseMode ?? "smart",
    learningEnabled: input.learningEnabled ?? true,
    learningReviewDays: input.learningReviewDays ?? 14,
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

function commentTargetFromMessage(message: any) {
  if (!message?.metadataJson) return null;
  try {
    const metadata = JSON.parse(message.metadataJson) as { messageType?: unknown; commentExternalId?: unknown };
    const messageType = typeof metadata.messageType === "string" ? metadata.messageType : "";
    const commentExternalId = typeof metadata.commentExternalId === "string" ? metadata.commentExternalId.trim().slice(0, 255) : "";
    if ((messageType === "comment" || messageType === "mention") && commentExternalId) return { commentExternalId };
  } catch {
    return null;
  }
  return null;
}

async function maybeSendAutomaticReply(input: { db: any; settings: any; storeId: number; conversation: any; sourceMessage: any; runId: number; body: string; confidence: number; actorUserId?: number | null; route: "fast" | "escalated"; facts: BotFacts; action?: BotActionDecision | null }) {
  if (input.settings.mode !== "auto_reply" || !input.settings.enabled || !channelIsEnabled(input.settings, input.conversation.channel)) return { status: "draft" as const, sent: false as const };
  try {
    const commentTarget = commentTargetFromMessage(input.sourceMessage);
    if (commentTarget) {
      if (input.conversation.channel !== "messenger" && input.conversation.channel !== "instagram") throw new Error("ردود التعليقات متاحة حالياً لـMessenger وInstagram فقط.");
      const account = await input.db.select({ providerAccountId: channelAccounts.providerAccountId }).from(channelAccounts).where(and(eq(channelAccounts.storeId, input.storeId), eq(channelAccounts.channel, input.conversation.channel))).limit(1);
      const providerAccountId = account[0]?.providerAccountId;
      if (!providerAccountId) throw new Error("لا يوجد أصل Meta محدد لرد التعليق.");
      await sendMetaCommentReply({ storeId: input.storeId, channel: input.conversation.channel, providerAccountId, commentExternalId: commentTarget.commentExternalId, body: input.body, idempotencyKey: `bot-comment:${input.runId}`, actorUserId: input.actorUserId ?? null, botRunId: input.runId });
    } else {
      const [account] = await input.db.select({ providerAccountId: channelAccounts.providerAccountId }).from(channelAccounts).where(and(eq(channelAccounts.storeId, input.storeId), input.conversation.channelAccountId ? eq(channelAccounts.id, input.conversation.channelAccountId) : eq(channelAccounts.channel, input.conversation.channel))).limit(1);
      const prefix = `${input.conversation.channel}:`;
      const recipientExternalId = typeof input.conversation.externalConversationId === "string" && input.conversation.externalConversationId.startsWith(prefix)
        ? input.conversation.externalConversationId.slice(prefix.length)
        : "";
      if (!account?.providerAccountId || !recipientExternalId) throw new Error("لا يمكن تحديد مستلم القناة الأصلية لرد Bot.");
      const product = input.action?.productCode ? input.facts.products.find(item => item.productCode === input.action?.productCode) : input.facts.products[0];
      const productLink = input.action?.type === "send_product_card" ? product?.productLink : null;
      const selectedColor = input.action?.colorName ? product?.colors.find(color => color.colorName === input.action?.colorName) : null;
      const mediaUrl = input.action?.type === "send_product_images" ? selectedColor?.imageUrls[0] ?? product?.imageUrls[0] ?? null : null;
      const body = productLink && !input.body.includes(productLink) ? `${input.body}\n${productLink}` : input.body;
      await sendMetaDirectMessage({ storeId: input.storeId, channel: input.conversation.channel, providerAccountId: account.providerAccountId, recipientExternalId, body, mediaUrl, mediaType: mediaUrl ? "image" : null, sourceExternalMessageId: input.sourceMessage.externalMessageId ?? null, replyWindowOpenedAt: input.sourceMessage.occurredAt ?? null, idempotencyKey: `bot:${input.runId}`, mode: "bot_guarded", botRunId: input.runId, projectionConversationId: input.conversation.id });
    }
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

export async function simulateCustomerBotInstruction(input: { storeId: number; instruction: string; sampleMessage: string; llm?: LlmInvoker }) {
  const db = await requireDb();
  const instruction = input.instruction.trim().slice(0, 12000);
  const sampleMessage = input.sampleMessage.trim().slice(0, 1200);
  if (instruction.length < 3) throw new Error("اكتبي تعليمة مشغل قصيرة قبل بدء المحاكاة.");
  if (sampleMessage.length < 2) throw new Error("اكتبي رسالة اختبار قصيرة قبل بدء المحاكاة.");
  const settings = await getSettings(db, input.storeId);
  const llm = input.llm ?? createAiTaskInvoker("customer_reply_fast", { storeId: input.storeId });
  const result = await llm({
    model: settings.fastModel,
    messages: [{ role: "system", content: [
      "أنت مختبر تعليمات لمساعد مبيعات عربي لمتجر حجابات.",
      "هذه محاكاة داخلية فقط: لا تستخدم أسعاراً أو مخزوناً أو طلبات حقيقية، ولا ترسل رسالة ولا تنشئ مسودة تشغيل.",
      "قيّم كيف ستؤثر تعليمة المشغل على أسلوب الرد، وأجب برسالة اختبار طبيعية مع درجة ثقة تقديرية.",
      "إذا كانت التعليمة تطلب اختلاق حقيقة أو تجاوز صلاحية أو وعداً بخصم أو تعديل طلب، اذكر أن النتيجة تحتاج موظفاً ولا تنفذها.",
      "أعد JSON فقط بالشكل: {\"reply\": string, \"confidence\": number من 0 إلى 100, \"needsEscalation\": boolean, \"escalationReason\": string أو null}.",
      `تعليمة المشغل قيد الاختبار: ${instruction}`,
      `رسالة العميل التجريبية: ${sampleMessage}`,
    ].join("\\n\\n") }],
    outputSchema: { name: "customer_bot_instruction_simulation", strict: true, schema: { type: "object", properties: { reply: { type: "string" }, confidence: { type: "integer" }, needsEscalation: { type: "boolean" }, escalationReason: { type: ["string", "null"] } }, required: ["reply", "confidence", "needsEscalation", "escalationReason"], additionalProperties: false } },
  });
  const parsed = parseStructuredReply(responseText(result));
  return { model: settings.fastModel, instruction, sampleMessage, reply: parsed.reply, confidence: parsed.confidence, needsEscalation: parsed.needsEscalation, escalationReason: parsed.escalationReason, externalSend: false as const, persistedRun: false as const, usage: result.usage ?? null };
}

export async function generateCustomerBotDraft(input: { storeId: number; actorUserId?: number | null; conversationId: number; sourceMessageId?: number; llm?: LlmInvoker; channelContext?: { body?: string | null; externalMessageId?: string | null; occurredAt?: Date } }) {
  const db = await requireDb();
  const settings = await getSettings(db, input.storeId);
  if (!settings.enabled) throw new Error("بوت العملاء غير مفعّل. فعّله أولاً من مركز البوت.");
  const conversation = await getScopedConversation(db, input.storeId, input.conversationId);
  const [sourceMessage] = input.sourceMessageId
    ? await db.select().from(inboxMessages).where(and(eq(inboxMessages.id, input.sourceMessageId), eq(inboxMessages.conversationId, conversation.id), eq(inboxMessages.direction, "inbound"))).limit(1)
    : await db.select().from(inboxMessages).where(and(eq(inboxMessages.conversationId, conversation.id), eq(inboxMessages.direction, "inbound"))).orderBy(desc(inboxMessages.occurredAt), desc(inboxMessages.id)).limit(1);
  if (!sourceMessage) throw new Error("لا توجد رسالة عميل واردة صالحة لإنشاء مسودة رد.");
  const channelSourceMessage = input.channelContext ? { ...sourceMessage, body: input.channelContext.body ?? sourceMessage.body ?? "", externalMessageId: input.channelContext.externalMessageId ?? sourceMessage.externalMessageId, occurredAt: input.channelContext.occurredAt ?? sourceMessage.occurredAt } : sourceMessage;
  if (channelSourceMessage.source === "historical_sync") throw new Error("لا يشغّل Bot-H3 الرسائل التاريخية؛ استخدمي مسار المرشحات والمراجعة أولاً.");
  const facts = await collectFacts(db, input.storeId, conversation.id, channelSourceMessage.body, channelSourceMessage.id);
  const immediateHandoff = humanHandoffTerms.test(channelSourceMessage.body);
  const imageReason = imageHandoffReason(facts.imageAnalyses);
  if (immediateHandoff || imageReason) {
    const reason = immediateHandoff ? "طلب حساس يحتاج موظفاً مخولاً" : imageReason!;
    const runId = await createRun(db, { storeId: input.storeId, conversationId: conversation.id, sourceMessageId: sourceMessage.id, route: "human_handoff", status: "handoff", escalationReason: reason, facts });
    await db.update(inboxConversations).set({ priority: true, status: "open", snoozedUntil: null, closedAt: null }).where(eq(inboxConversations.id, conversation.id));
    await notifyHumanHandoffSafely({ storeId: input.storeId, conversation, reason });
    return { runId, route: "human_handoff" as const, status: "handoff" as const, replyDraft: null, confidence: null, escalationReason: reason };
  }
  const fastLlm = input.llm ?? createAiTaskInvoker("customer_reply_fast", { storeId: input.storeId, conversationId: conversation.id });
  const escalationLlm = input.llm ?? createAiTaskInvoker("customer_reply_escalation", { storeId: input.storeId, conversationId: conversation.id });
  const preEscalationReason = shouldEscalateBeforeModel(sourceMessage.body, facts.products.length, facts.recentMessages.length, facts.imageAnalyses);
  const fastReserved = await reserveUsage({ db, storeId: input.storeId, kind: "fast", limit: settings.maxDailyReplies });
  if (!fastReserved) {
    const runId = await createRun(db, { storeId: input.storeId, conversationId: conversation.id, sourceMessageId: sourceMessage.id, route: "human_handoff", status: "handoff", escalationReason: "تجاوز حد الردود اليومية للمسار السريع", facts });
    await notifyHumanHandoffSafely({ storeId: input.storeId, conversation, reason: "تجاوز حد الردود اليومية للمسار السريع" });
    return { runId, route: "human_handoff" as const, status: "handoff" as const, replyDraft: null, confidence: null, escalationReason: "تجاوز حد الردود اليومية للمسار السريع" };
  }
  try {
    if (!preEscalationReason) {
      const fastResult = await fastLlm({ model: settings.fastModel, messages: [{ role: "system", content: assistantPrompt({ facts, incoming: channelSourceMessage.body, stronger: false, dialect: settings.dialect, tone: settings.tone, operatorInstructions: settings.operatorInstructions, productResponseMode: settings.productResponseMode, templates: { welcome: settings.welcomeTemplate, price: settings.priceReplyTemplate, colors: settings.colorOfferTemplate, card: settings.productCardTemplate, orderSummary: settings.orderSummaryTemplate, confirmation: settings.confirmationTemplate, humanWaiting: settings.humanWaitingTemplate } }) }], outputSchema: { name: "customer_assistant_reply", strict: true, schema: { type: "object", properties: { reply: { type: "string" }, confidence: { type: "integer" }, needsEscalation: { type: "boolean" }, escalationReason: { type: ["string", "null"] }, action: { type: "string", enum: [...botActionTypes] }, productCode: { type: ["string", "null"] }, colorName: { type: ["string", "null"] }, quantity: { type: ["integer", "null"] }, actionCaption: { type: ["string", "null"] } }, required: ["reply", "confidence", "needsEscalation", "escalationReason", "action", "productCode", "colorName", "quantity", "actionCaption"], additionalProperties: false } } });
      const parsed = parseStructuredReply(responseText(fastResult));
      const action = applyProductResponsePolicy(parsed.action, settings, facts);
      if (!parsed.needsEscalation && action.type !== "notify_human" && parsed.confidence >= settings.minimumConfidence && parsed.reply) {
        const runId = await createRun(db, { storeId: input.storeId, conversationId: conversation.id, sourceMessageId: sourceMessage.id, route: "fast", status: "draft", model: fastResult.model || settings.fastModel, confidence: parsed.confidence, facts, replyDraft: parsed.reply, action, usage: fastResult.usage });
        if (action.type === "order_summary") await createCustomerBotOrderDraft({ storeId: input.storeId, conversationId: conversation.id, botRunId: runId, facts, action });
        const delivery = await maybeSendAutomaticReply({ db, settings, storeId: input.storeId, conversation, sourceMessage, runId, body: parsed.reply, confidence: parsed.confidence, actorUserId: input.actorUserId, route: "fast", facts, action });
        return { runId, route: "fast" as const, status: delivery.status, replyDraft: parsed.reply, confidence: parsed.confidence, escalationReason: delivery.error ?? null };
      }
        return generateEscalatedDraft({ db, settings, facts, sourceMessage: channelSourceMessage, conversationId: conversation.id, storeId: input.storeId, llm: escalationLlm, reason: parsed.escalationReason || "ثقة المسار السريع أقل من الحد" });
    }
    return generateEscalatedDraft({ db, settings, facts, sourceMessage: channelSourceMessage, conversationId: conversation.id, storeId: input.storeId, llm: escalationLlm, reason: preEscalationReason });
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
  const result = await input.llm({ model: input.settings.escalationModel, messages: [{ role: "system", content: assistantPrompt({ facts: input.facts, incoming: input.sourceMessage.body, stronger: true, dialect: input.settings.dialect, tone: input.settings.tone, operatorInstructions: input.settings.operatorInstructions, productResponseMode: input.settings.productResponseMode, templates: { welcome: input.settings.welcomeTemplate, price: input.settings.priceReplyTemplate, colors: input.settings.colorOfferTemplate, card: input.settings.productCardTemplate, orderSummary: input.settings.orderSummaryTemplate, confirmation: input.settings.confirmationTemplate, humanWaiting: input.settings.humanWaitingTemplate } }) }], outputSchema: { name: "customer_assistant_escalated_reply", strict: true, schema: { type: "object", properties: { reply: { type: "string" }, confidence: { type: "integer" }, needsEscalation: { type: "boolean" }, escalationReason: { type: ["string", "null"] }, action: { type: "string", enum: [...botActionTypes] }, productCode: { type: ["string", "null"] }, colorName: { type: ["string", "null"] }, quantity: { type: ["integer", "null"] }, actionCaption: { type: ["string", "null"] } }, required: ["reply", "confidence", "needsEscalation", "escalationReason", "action", "productCode", "colorName", "quantity", "actionCaption"], additionalProperties: false } } });
  const parsed = parseStructuredReply(responseText(result));
  const action = applyProductResponsePolicy(parsed.action, input.settings, input.facts);
  if (parsed.needsEscalation || action.type === "notify_human" || parsed.confidence < input.settings.minimumConfidence || !parsed.reply) {
    const runId = await createRun(input.db, { storeId: input.storeId, conversationId: input.conversationId, sourceMessageId: input.sourceMessage.id, route: "human_handoff", status: "handoff", model: result.model || input.settings.escalationModel, confidence: parsed.confidence, escalationReason: parsed.escalationReason || input.reason, facts: input.facts, usage: result.usage });
    const conversation = await getScopedConversation(input.db, input.storeId, input.conversationId);
    await notifyHumanHandoffSafely({ storeId: input.storeId, conversation, reason: parsed.escalationReason || input.reason });
    return { runId, route: "human_handoff" as const, status: "handoff" as const, replyDraft: null, confidence: parsed.confidence, escalationReason: parsed.escalationReason || input.reason };
  }
  const runId = await createRun(input.db, { storeId: input.storeId, conversationId: input.conversationId, sourceMessageId: input.sourceMessage.id, route: "escalated", status: "draft", model: result.model || input.settings.escalationModel, confidence: parsed.confidence, escalationReason: input.reason, facts: input.facts, replyDraft: parsed.reply, action, usage: result.usage });
  if (action.type === "order_summary") await createCustomerBotOrderDraft({ storeId: input.storeId, conversationId: input.conversationId, botRunId: runId, facts: input.facts, action });
  const conversation = await getScopedConversation(input.db, input.storeId, input.conversationId);
  const delivery = await maybeSendAutomaticReply({ db: input.db, settings: input.settings, storeId: input.storeId, conversation, sourceMessage: input.sourceMessage, runId, body: parsed.reply, confidence: parsed.confidence, route: "escalated", facts: input.facts, action });
  return { runId, route: "escalated" as const, status: delivery.status, replyDraft: parsed.reply, confidence: parsed.confidence, escalationReason: delivery.error ?? input.reason };
}
