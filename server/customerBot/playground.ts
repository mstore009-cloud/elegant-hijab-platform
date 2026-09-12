import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import {
  customerBotBehaviorCards,
  customerBotCommandRequests,
  customerBotKnowledgeArticles,
  customerBotLearningProposals,
  customerBotPlaybooks,
  customerBotPlaygroundMessages,
  customerBotPlaygroundSessions,
  customerBotTestCases,
  customerBotSettings,
  productVariants,
  products,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { createAiTaskInvoker } from "../ai/taskInvoker";
import { transcribeAudio } from "../_core/voiceTranscription";
import { ENV } from "../_core/env";
import { storagePut } from "../storage";
import { getCustomerBotSettings } from "./db";

export const playgroundModes = ["live_read_only", "conversation_context", "new_test_customer", "existing_customer_read_only", "order_simulation"] as const;
export const playgroundChannels = ["whatsapp", "instagram", "messenger", "internal"] as const;
export const proposalCategories = ["dialect_style", "reply_example", "knowledge", "sales_playbook", "test_case", "guardrail", "knowledge_gap"] as const;
export const proposalStatuses = ["draft", "approved", "rejected", "archived"] as const;
export const commandStatuses = ["transcribed", "needs_clarification", "previewed", "saved_draft", "cancelled", "failed"] as const;

type ProposalCategory = (typeof proposalCategories)[number];
type PlaygroundChannel = (typeof playgroundChannels)[number];
type PlaygroundMode = (typeof playgroundModes)[number];

type BotAction = { type: "none" | "send_product_images" | "send_product_card" | "order_summary" | "notify_human"; productCode: string | null; colorName: string | null; quantity: number | null; caption: string | null };
type StructuredReply = { reply: string; confidence: number; needsEscalation: boolean; escalationReason: string | null; action: BotAction };
type CommandClassification = { destination: ProposalCategory | "clarification"; title: string; body: string; explanation: string; warning: string | null; clarificationQuestion: string | null; confidence: number };

const audioTypes = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/x-pn-wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a"]);
const audioExtensions = new Set(["mp3", "wav", "m4a", "ogg", "webm"]);
const maxAudioBytes = 16 * 1024 * 1024;

export function normalizeAudioMimeType(mimeType: string, fileName = "") {
  const baseMime = mimeType.trim().toLowerCase().split(";", 1)[0] ?? "";
  if (audioTypes.has(baseMime)) {
    if (["audio/x-wav", "audio/wave", "audio/x-pn-wav"].includes(baseMime)) return "audio/wav";
    if (["audio/m4a", "audio/x-m4a"].includes(baseMime)) return "audio/mp4";
    if (baseMime === "audio/mp3") return "audio/mpeg";
    return baseMime;
  }
  if (baseMime && baseMime !== "application/octet-stream") return null;
  const extension = fileName.trim().toLowerCase().split(".").pop() ?? "";
  if (audioExtensions.has(extension)) {
    if (extension === "mp3") return "audio/mpeg";
    if (extension === "wav") return "audio/wav";
    if (extension === "m4a") return "audio/mp4";
    return `audio/${extension}`;
  }
  return null;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

function responseText(result: any) {
  const value = result?.choices?.[0]?.message?.content;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
  return "";
}

function safeJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function clampConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

function parseReply(value: string): StructuredReply {
  const parsed = safeJson<any>(value, {});
  const types = new Set(["none", "send_product_images", "send_product_card", "order_summary", "notify_human"]);
  const actionType = typeof parsed.action === "string" && types.has(parsed.action) ? parsed.action : "notify_human";
  return {
    reply: typeof parsed.reply === "string" ? parsed.reply.trim().slice(0, 1800) : "",
    confidence: clampConfidence(parsed.confidence),
    needsEscalation: parsed.needsEscalation === true,
    escalationReason: typeof parsed.escalationReason === "string" ? parsed.escalationReason.trim().slice(0, 240) : null,
    action: {
      type: actionType,
      productCode: typeof parsed.productCode === "string" ? parsed.productCode.trim().slice(0, 80) : null,
      colorName: typeof parsed.colorName === "string" ? parsed.colorName.trim().slice(0, 100) : null,
      quantity: typeof parsed.quantity === "number" && Number.isFinite(parsed.quantity) ? Math.max(1, Math.min(20, Math.round(parsed.quantity))) : null,
      caption: typeof parsed.actionCaption === "string" ? parsed.actionCaption.trim().slice(0, 500) : null,
    },
  };
}

function extractTerms(value: string) {
  return Array.from(new Set(value.split(/[^A-Za-z0-9\u0600-\u06FF-]+/).map(term => term.trim()).filter(term => term.length >= 3))).slice(0, 6);
}

async function scopedSession(db: any, storeId: number, sessionId: number) {
  const [session] = await db.select().from(customerBotPlaygroundSessions).where(and(eq(customerBotPlaygroundSessions.id, sessionId), eq(customerBotPlaygroundSessions.storeId, storeId))).limit(1);
  if (!session) throw new Error("جلسة المختبر غير موجودة في المتجر التشغيلي الحالي.");
  return session;
}

async function getPlaygroundFacts(db: any, storeId: number, body: string) {
  const terms = extractTerms(body);
  const productFilters = terms.flatMap(term => [like(products.name, `%${term}%`), like(products.productCode, `%${term}%`), like(products.category, `%${term}%`)]);
  const knowledgeFilters = terms.flatMap(term => [like(customerBotKnowledgeArticles.title, `%${term}%`), like(customerBotKnowledgeArticles.body, `%${term}%`)]);
  const [matches, knowledge] = await Promise.all([
    productFilters.length
      ? db.select({ id: products.id, productCode: products.productCode, name: products.name, category: products.category, sellingPrice: products.sellingPrice, description: products.description }).from(products).where(and(eq(products.storeId, storeId), eq(products.status, "active"), or(...productFilters)!)).limit(5)
      : [],
    knowledgeFilters.length
      ? db.select({ id: customerBotKnowledgeArticles.id, title: customerBotKnowledgeArticles.title, kind: customerBotKnowledgeArticles.kind, body: customerBotKnowledgeArticles.body }).from(customerBotKnowledgeArticles).where(and(eq(customerBotKnowledgeArticles.storeId, storeId), eq(customerBotKnowledgeArticles.status, "approved"), or(...knowledgeFilters)!)).limit(5)
      : db.select({ id: customerBotKnowledgeArticles.id, title: customerBotKnowledgeArticles.title, kind: customerBotKnowledgeArticles.kind, body: customerBotKnowledgeArticles.body }).from(customerBotKnowledgeArticles).where(and(eq(customerBotKnowledgeArticles.storeId, storeId), eq(customerBotKnowledgeArticles.status, "approved"))).limit(3),
  ]);
  const variants = matches.length
    ? await db.select({ productId: productVariants.productId, colorName: productVariants.colorName, sizeLabel: productVariants.sizeLabel, inventoryQuantity: productVariants.inventoryQuantity, availability: productVariants.availability }).from(productVariants).where(inArray(productVariants.productId, matches.map((product: any) => product.id)))
    : [];
  return {
    products: matches.map((product: any) => ({
      productCode: product.productCode,
      name: product.name,
      category: product.category,
      sellingPrice: product.sellingPrice,
      description: product.description,
      colors: variants.filter((variant: any) => variant.productId === product.id).map((variant: any) => ({ colorName: variant.colorName, size: variant.sizeLabel, available: variant.inventoryQuantity > 0 && variant.availability !== "out_of_stock" })),
    })),
    knowledge,
  };
}

export async function createPlaygroundSession(input: { storeId: number; actorUserId: number; mode: PlaygroundMode; channel: PlaygroundChannel; conversationId?: number | null }) {
  const db = await requireDb();
  const inserted = await db.insert(customerBotPlaygroundSessions).values({ storeId: input.storeId, createdByUserId: input.actorUserId, mode: input.mode, channel: input.channel, conversationId: input.conversationId ?? null });
  return scopedSession(db, input.storeId, Number(inserted[0].insertId));
}

export async function listPlaygroundSessions(storeId: number) {
  const db = await requireDb();
  return db.select().from(customerBotPlaygroundSessions).where(eq(customerBotPlaygroundSessions.storeId, storeId)).orderBy(desc(customerBotPlaygroundSessions.createdAt)).limit(30);
}

export async function getPlaygroundSession(storeId: number, sessionId: number) {
  const db = await requireDb();
  const session = await scopedSession(db, storeId, sessionId);
  const messages = await db.select().from(customerBotPlaygroundMessages).where(and(eq(customerBotPlaygroundMessages.storeId, storeId), eq(customerBotPlaygroundMessages.sessionId, session.id))).orderBy(customerBotPlaygroundMessages.createdAt, customerBotPlaygroundMessages.id);
  return { session, messages };
}

export async function closePlaygroundSession(input: { storeId: number; sessionId: number }) {
  const db = await requireDb();
  await scopedSession(db, input.storeId, input.sessionId);
  await db.update(customerBotPlaygroundSessions).set({ status: "closed", closedAt: new Date() }).where(eq(customerBotPlaygroundSessions.id, input.sessionId));
}

export async function sendPlaygroundMessage(input: { storeId: number; sessionId: number; actorUserId: number; body: string }) {
  const db = await requireDb();
  const session = await scopedSession(db, input.storeId, input.sessionId);
  if (session.status !== "open") throw new Error("هذه الجلسة مغلقة. ابدئي جلسة اختبار جديدة.");
  const body = input.body.trim().slice(0, 1800);
  if (body.length < 2) throw new Error("اكتبي رسالة اختبار صالحة أولاً.");
  await db.insert(customerBotPlaygroundMessages).values({ storeId: input.storeId, sessionId: session.id, role: "customer", body });
  const facts = await getPlaygroundFacts(db, input.storeId, body);
  const settings = await getCustomerBotSettings(input.storeId);
  const previous = await db.select({ role: customerBotPlaygroundMessages.role, body: customerBotPlaygroundMessages.body }).from(customerBotPlaygroundMessages).where(and(eq(customerBotPlaygroundMessages.storeId, input.storeId), eq(customerBotPlaygroundMessages.sessionId, session.id))).orderBy(desc(customerBotPlaygroundMessages.id)).limit(6);
  const invoke = createAiTaskInvoker("customer_reply_fast", { storeId: input.storeId });
  const result = await invoke({
    model: settings.fastModel,
    messages: [{ role: "system", content: [
      "أنت بوت مبيعات عربي لمتجر حجابات داخل مختبر آمن.",
      `اللهجة: ${settings.dialect}. النبرة: ${settings.tone}.`,
      settings.operatorInstructions ? `التعليمات المعتمدة: ${settings.operatorInstructions}` : "لا توجد تعليمات إضافية.",
      "هذه تجربة داخلية للقراءة فقط. لا ترسل Meta، لا تنشئ طلباً نهائياً، لا تعدّل CRM أو مخزوناً، ولا تدّعِ تنفيذ أي فعل خارجي.",
      "استخدم حقائق المنتجات والمعرفة المرفقة فقط. السعر والتوفر معلومات حية للقراءة؛ لا تحفظها كتعليمات. عند الخصم أو الإرجاع أو الإلغاء أو تعديلات الطلب أو نقص الحقيقة، استخدم notify_human مع رسالة مهذبة لا تكشف التحويل الداخلي.",
      "أعد JSON فقط: {reply:string, confidence:number, needsEscalation:boolean, escalationReason:string|null, action:string, productCode:string|null, colorName:string|null, quantity:number|null, actionCaption:string|null}.",
      `حقائق القراءة الحية: ${JSON.stringify(facts)}`,
      `سجل الاختبار القريب: ${JSON.stringify(previous.reverse())}`,
      `رسالة العميل الجديدة: ${body}`,
    ].join("\n\n") }],
    outputSchema: { name: "customer_bot_playground_reply", strict: true, schema: { type: "object", properties: { reply: { type: "string" }, confidence: { type: "integer" }, needsEscalation: { type: "boolean" }, escalationReason: { type: ["string", "null"] }, action: { type: "string", enum: ["none", "send_product_images", "send_product_card", "order_summary", "notify_human"] }, productCode: { type: ["string", "null"] }, colorName: { type: ["string", "null"] }, quantity: { type: ["integer", "null"] }, actionCaption: { type: ["string", "null"] } }, required: ["reply", "confidence", "needsEscalation", "escalationReason", "action", "productCode", "colorName", "quantity", "actionCaption"], additionalProperties: false } },
  });
  const parsed = parseReply(responseText(result));
  const safeReply = parsed.reply || "أتحقق من التفاصيل وأرجع لج بعد لحظات.";
  const inserted = await db.insert(customerBotPlaygroundMessages).values({ storeId: input.storeId, sessionId: session.id, role: "assistant", body: safeReply, confidence: parsed.confidence, actionJson: JSON.stringify({ ...parsed.action, needsEscalation: parsed.needsEscalation, escalationReason: parsed.escalationReason, simulation: true }) });
  const [assistantMessage] = await db.select().from(customerBotPlaygroundMessages).where(eq(customerBotPlaygroundMessages.id, Number(inserted[0].insertId))).limit(1);
  return { assistantMessage, facts, externalSend: false as const, finalOrderCreated: false as const, usage: result.usage ?? null };
}

function proposalTitle(category: ProposalCategory, editedReply: string) {
  const prefix: Record<ProposalCategory, string> = { dialect_style: "تحسين لهجة", reply_example: "مثال رد", knowledge: "بطاقة معرفة", sales_playbook: "إجراء بيع", test_case: "حالة اختبار", guardrail: "حاجز أمان", knowledge_gap: "فجوة معرفة" };
  return `${prefix[category]} — ${editedReply.replace(/\s+/g, " ").slice(0, 120)}`;
}

function rejectDynamicFacts(value: string, category: ProposalCategory) {
  if (category === "knowledge" && /(?:سعر|السعر|مخزون|متوفر|متاحة|نفد|كمية|دينار|د\.?\s*ع|iqd|\b\d{3,}\b)/i.test(value)) {
    throw new Error("لا يمكن حفظ السعر أو المخزون كبطاقة معرفة؛ يجب أن يبقيا من بيانات المنتجات الحية.");
  }
}

export async function createLearningProposal(input: { storeId: number; actorUserId: number; sessionId: number; sourceMessageId: number; category: ProposalCategory; editedReply: string; title?: string | null; body?: string | null }) {
  const db = await requireDb();
  const session = await scopedSession(db, input.storeId, input.sessionId);
  const [message] = await db.select().from(customerBotPlaygroundMessages).where(and(eq(customerBotPlaygroundMessages.id, input.sourceMessageId), eq(customerBotPlaygroundMessages.storeId, input.storeId), eq(customerBotPlaygroundMessages.sessionId, session.id), eq(customerBotPlaygroundMessages.role, "assistant"))).limit(1);
  if (!message) throw new Error("رد المختبر المحدد غير موجود في الجلسة الحالية.");
  const editedReply = input.editedReply.trim().slice(0, 5000);
  if (editedReply.length < 2) throw new Error("اكتبي التعديل المقترح أولاً.");
  rejectDynamicFacts(editedReply, input.category);
  const invoke = createAiTaskInvoker("customer_reply_fast", { storeId: input.storeId });
  const settings = await getCustomerBotSettings(input.storeId);
  const analysis = await invoke({ model: settings.fastModel, messages: [{ role: "system", content: `حلل فرق رد بوت عن نسخة حررها مدير متجر. أعد JSON فقط بالشكل {"summary":string,"suggestedCategory":string,"reason":string,"containsDynamicFact":boolean}. التصنيفات المسموحة: ${proposalCategories.join(", ")}. لا تكشف التفكير الداخلي.` }, { role: "user", content: `الرد الأصلي:\n${message.body}\n\nالنسخة المعدلة:\n${editedReply}` }], outputSchema: { name: "customer_bot_learning_proposal", strict: true, schema: { type: "object", properties: { summary: { type: "string" }, suggestedCategory: { type: "string", enum: [...proposalCategories] }, reason: { type: "string" }, containsDynamicFact: { type: "boolean" } }, required: ["summary", "suggestedCategory", "reason", "containsDynamicFact"], additionalProperties: false } } });
  const aiClassification = safeJson<any>(responseText(analysis), { summary: "تعديل مراجَع", suggestedCategory: input.category, reason: "تصنيف يدوي", containsDynamicFact: false });
  if (aiClassification.containsDynamicFact && input.category === "knowledge") throw new Error("يحتوي التعديل على حقيقة تشغيلية متغيرة. احفظي أسلوب الرد فقط واتركي السعر أو المخزون لمصدره الحي.");
  const body = (input.body?.trim() || editedReply).slice(0, 12000);
  const inserted = await db.insert(customerBotLearningProposals).values({ storeId: input.storeId, sessionId: session.id, sourceMessageId: message.id, category: input.category, originalReply: message.body, editedReply, title: (input.title?.trim() || proposalTitle(input.category, editedReply)).slice(0, 240), body, aiClassificationJson: JSON.stringify(aiClassification), createdByUserId: input.actorUserId });
  const [proposal] = await db.select().from(customerBotLearningProposals).where(eq(customerBotLearningProposals.id, Number(inserted[0].insertId))).limit(1);
  return proposal;
}

export async function listLearningProposals(storeId: number, status?: (typeof proposalStatuses)[number]) {
  const db = await requireDb();
  return db.select().from(customerBotLearningProposals).where(and(eq(customerBotLearningProposals.storeId, storeId), status ? eq(customerBotLearningProposals.status, status) : undefined)).orderBy(desc(customerBotLearningProposals.updatedAt)).limit(100);
}

async function scopedProposal(db: any, storeId: number, proposalId: number) {
  const [proposal] = await db.select().from(customerBotLearningProposals).where(and(eq(customerBotLearningProposals.id, proposalId), eq(customerBotLearningProposals.storeId, storeId))).limit(1);
  if (!proposal) throw new Error("اقتراح التعلم غير موجود في المتجر الحالي.");
  return proposal;
}

export async function setLearningProposalStatus(input: { storeId: number; actorUserId: number; proposalId: number; status: "approved" | "rejected" | "archived" }) {
  const db = await requireDb();
  const proposal = await scopedProposal(db, input.storeId, input.proposalId);
  await db.update(customerBotLearningProposals).set({ status: input.status, reviewedByUserId: input.actorUserId, reviewedAt: new Date() }).where(eq(customerBotLearningProposals.id, proposal.id));
  if (input.status !== "approved") return { proposal, artifact: null };
  let artifact: { type: string; id: number } | null = null;
  if (proposal.category === "knowledge") {
    const result = await db.insert(customerBotKnowledgeArticles).values({ storeId: input.storeId, title: proposal.title, kind: "faq", body: proposal.body, source: "review_feedback", status: "draft", createdByUserId: input.actorUserId });
    artifact = { type: "knowledge", id: Number(result[0].insertId) };
  } else if (proposal.category === "dialect_style" || proposal.category === "reply_example" || proposal.category === "guardrail") {
    const kind = proposal.category === "dialect_style" ? "dialect" : proposal.category === "guardrail" ? "guardrail" : "reply_example";
    const result = await db.insert(customerBotBehaviorCards).values({ storeId: input.storeId, title: proposal.title, kind, body: proposal.body, sourceProposalId: proposal.id, createdByUserId: input.actorUserId });
    artifact = { type: "behavior", id: Number(result[0].insertId) };
  } else if (proposal.category === "sales_playbook") {
    const result = await db.insert(customerBotPlaybooks).values({ storeId: input.storeId, title: proposal.title, triggerJson: JSON.stringify({ trigger: "manual_review_required" }), stepsJson: JSON.stringify([{ instruction: proposal.body }]), guardrailsJson: JSON.stringify(["لا إرسال خارجي أو تغيير تجاري من المسودة"]), sourceProposalId: proposal.id, createdByUserId: input.actorUserId });
    artifact = { type: "playbook", id: Number(result[0].insertId) };
  } else if (proposal.category === "test_case") {
    const result = await db.insert(customerBotTestCases).values({ storeId: input.storeId, title: proposal.title, inputJson: JSON.stringify({ prompt: proposal.originalReply }), expectedJson: JSON.stringify({ expected: proposal.editedReply }), sourceProposalId: proposal.id, createdByUserId: input.actorUserId });
    artifact = { type: "test_case", id: Number(result[0].insertId) };
  }
  return { proposal, artifact };
}

function parseCommand(value: string): CommandClassification {
  const parsed = safeJson<any>(value, {});
  const valid = new Set([...proposalCategories, "clarification"]);
  const destination = typeof parsed.destination === "string" && valid.has(parsed.destination) ? parsed.destination : "clarification";
  return { destination, title: typeof parsed.title === "string" ? parsed.title.trim().slice(0, 240) : "تعليمة تحتاج مراجعة", body: typeof parsed.body === "string" ? parsed.body.trim().slice(0, 12000) : "", explanation: typeof parsed.explanation === "string" ? parsed.explanation.trim().slice(0, 1200) : "لم يتمكن المساعد من تفسير الأمر بوضوح.", warning: typeof parsed.warning === "string" ? parsed.warning.trim().slice(0, 500) : null, clarificationQuestion: typeof parsed.clarificationQuestion === "string" ? parsed.clarificationQuestion.trim().slice(0, 800) : null, confidence: clampConfidence(parsed.confidence) };
}

async function classifyCommand(storeId: number, text: string) {
  const settings = await getCustomerBotSettings(storeId);
  const invoke = createAiTaskInvoker("customer_reply_fast", { storeId });
  const result = await invoke({
    model: settings.fastModel,
    messages: [{ role: "system", content: [
      "أنت مساعد إعداد لبوت متجر حجابات. حوّل أمر المدير إلى اقتراح مسودة قابل للمراجعة؛ لا تنفذ تغييراً.",
      `الوجهات المسموحة: ${proposalCategories.join(", ")} أو clarification.`,
      "المعرفة للسياسات والحقائق الثابتة فقط. الأسلوب واللهجة في dialect_style أو reply_example. متى يرسل البوت صورة أو بطاقة أو ملخصاً في sales_playbook. الرد الممنوع في guardrail. السؤال المتكرر في test_case. النقص في knowledge_gap.",
      "السعر والمخزون وحالة الطلب حقائق حية وليست بطاقة نصية. أوامر تشغيل القنوات أو إرسال رسائل أو اعتماد نهائي يجب أن تكون clarification مع تحذير أنها تحتاج شاشة الإعدادات وتأكيداً مستقلاً.",
      "أعد JSON فقط: {destination:string,title:string,body:string,explanation:string,warning:string|null,clarificationQuestion:string|null,confidence:number}.",
    ].join("\n\n") }, { role: "user", content: text }],
    outputSchema: { name: "customer_bot_command_interpretation", strict: true, schema: { type: "object", properties: { destination: { type: "string", enum: [...proposalCategories, "clarification"] }, title: { type: "string" }, body: { type: "string" }, explanation: { type: "string" }, warning: { type: ["string", "null"] }, clarificationQuestion: { type: ["string", "null"] }, confidence: { type: "integer" } }, required: ["destination", "title", "body", "explanation", "warning", "clarificationQuestion", "confidence"], additionalProperties: false } },
  });
  return { classification: parseCommand(responseText(result)), usage: result.usage ?? null };
}

export async function createTextCommandRequest(input: { storeId: number; actorUserId: number; text: string }) {
  const text = input.text.trim().slice(0, 12000);
  if (text.length < 3) throw new Error("اكتبي أمراً واضحاً للمساعد أولاً.");
  const { classification, usage } = await classifyCommand(input.storeId, text);
  const db = await requireDb();
  const inserted = await db.insert(customerBotCommandRequests).values({ storeId: input.storeId, createdByUserId: input.actorUserId, inputType: "text", originalText: text, transcript: text, classificationJson: JSON.stringify(classification), proposedChangeJson: JSON.stringify({ category: classification.destination, title: classification.title, body: classification.body }), status: classification.destination === "clarification" ? "needs_clarification" : "previewed" });
  const [command] = await db.select().from(customerBotCommandRequests).where(eq(customerBotCommandRequests.id, Number(inserted[0].insertId))).limit(1);
  return { command, classification, usage };
}

function publicUrl(path: string) { try { return new URL(path, new URL(ENV.metaRedirectUri).origin).toString(); } catch { throw new Error("لا يتوفر النطاق العام اللازم لتحويل التسجيل الصوتي إلى نص."); } }

export async function createAudioCommandRequest(input: { storeId: number; actorUserId: number; fileName: string; mimeType: string; base64: string }) {
  const mimeType = normalizeAudioMimeType(input.mimeType, input.fileName);
  if (!mimeType) throw new Error("ارفعي أو سجّلي MP3 أو WAV أو M4A أو OGG أو WEBM فقط.");
  const bytes = Buffer.from(input.base64, "base64");
  if (!bytes.length || bytes.length > maxAudioBytes) throw new Error("يجب ألا يتجاوز التسجيل الصوتي 16 ميغابايت.");
  const safeName = (input.fileName.trim() || "bot-command.webm").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 255);
  const stored = await storagePut(`bot-commands/${input.storeId}/${Date.now()}-${safeName}`, bytes, mimeType);
  const transcription = await transcribeAudio({ audioUrl: publicUrl(stored.url), language: "ar", prompt: "حوّل الكلام العراقي إلى نص كما قيل، ولا تصححه إلى العربية الفصحى." });
  const db = await requireDb();
  if ("error" in transcription) {
    const inserted = await db.insert(customerBotCommandRequests).values({ storeId: input.storeId, createdByUserId: input.actorUserId, inputType: "audio", storageKey: stored.key, status: "failed", errorSummary: `${transcription.error}${transcription.details ? `: ${transcription.details}` : ""}`.slice(0, 500) });
    const [command] = await db.select().from(customerBotCommandRequests).where(eq(customerBotCommandRequests.id, Number(inserted[0].insertId))).limit(1);
    return { command, classification: null };
  }
  const transcript = transcription.text.trim().slice(0, 12000);
  if (transcript.length < 3) throw new Error("لم ينتج عن التسجيل نص كافٍ لفهم الأمر. صححي النص أو أعيدي التسجيل.");
  const { classification, usage } = await classifyCommand(input.storeId, transcript);
  const inserted = await db.insert(customerBotCommandRequests).values({ storeId: input.storeId, createdByUserId: input.actorUserId, inputType: "audio", storageKey: stored.key, transcript, classificationJson: JSON.stringify(classification), proposedChangeJson: JSON.stringify({ category: classification.destination, title: classification.title, body: classification.body }), status: classification.destination === "clarification" ? "needs_clarification" : "previewed" });
  const [command] = await db.select().from(customerBotCommandRequests).where(eq(customerBotCommandRequests.id, Number(inserted[0].insertId))).limit(1);
  return { command, classification, usage };
}

export async function listCommandRequests(storeId: number) {
  const db = await requireDb();
  return db.select().from(customerBotCommandRequests).where(eq(customerBotCommandRequests.storeId, storeId)).orderBy(desc(customerBotCommandRequests.updatedAt)).limit(50);
}

export async function saveCommandAsProposal(input: { storeId: number; actorUserId: number; commandId: number; category: ProposalCategory; title: string; body: string }) {
  const db = await requireDb();
  const [command] = await db.select().from(customerBotCommandRequests).where(and(eq(customerBotCommandRequests.id, input.commandId), eq(customerBotCommandRequests.storeId, input.storeId))).limit(1);
  if (!command) throw new Error("أمر المساعد غير موجود في المتجر الحالي.");
  rejectDynamicFacts(input.body, input.category);
  const inserted = await db.insert(customerBotLearningProposals).values({ storeId: input.storeId, category: input.category, title: input.title.trim().slice(0, 240), body: input.body.trim().slice(0, 12000), aiClassificationJson: command.classificationJson, createdByUserId: input.actorUserId });
  await db.update(customerBotCommandRequests).set({ status: "saved_draft" }).where(eq(customerBotCommandRequests.id, command.id));
  const [proposal] = await db.select().from(customerBotLearningProposals).where(eq(customerBotLearningProposals.id, Number(inserted[0].insertId))).limit(1);
  return proposal;
}

export async function listBehaviorCards(storeId: number) {
  const db = await requireDb();
  return db.select().from(customerBotBehaviorCards).where(eq(customerBotBehaviorCards.storeId, storeId)).orderBy(desc(customerBotBehaviorCards.updatedAt)).limit(100);
}

export async function listPlaybooks(storeId: number) {
  const db = await requireDb();
  return db.select().from(customerBotPlaybooks).where(eq(customerBotPlaybooks.storeId, storeId)).orderBy(desc(customerBotPlaybooks.updatedAt)).limit(100);
}

export async function listTestCases(storeId: number) {
  const db = await requireDb();
  return db.select().from(customerBotTestCases).where(eq(customerBotTestCases.storeId, storeId)).orderBy(desc(customerBotTestCases.updatedAt)).limit(100);
}

export async function setBehaviorCardStatus(input: { storeId: number; actorUserId: number; cardId: number; status: "approved" | "archived" }) {
  const db = await requireDb();
  const [card] = await db.select().from(customerBotBehaviorCards).where(and(eq(customerBotBehaviorCards.id, input.cardId), eq(customerBotBehaviorCards.storeId, input.storeId))).limit(1);
  if (!card) throw new Error("بطاقة السلوك غير موجودة في المتجر الحالي.");
  await db.update(customerBotBehaviorCards).set({ status: input.status, approvedByUserId: input.status === "approved" ? input.actorUserId : null, approvedAt: input.status === "approved" ? new Date() : null }).where(eq(customerBotBehaviorCards.id, card.id));
  return card;
}

export async function setPlaybookStatus(input: { storeId: number; actorUserId: number; playbookId: number; status: "approved" | "archived" }) {
  const db = await requireDb();
  const [playbook] = await db.select().from(customerBotPlaybooks).where(and(eq(customerBotPlaybooks.id, input.playbookId), eq(customerBotPlaybooks.storeId, input.storeId))).limit(1);
  if (!playbook) throw new Error("إجراء البيع غير موجود في المتجر الحالي.");
  await db.update(customerBotPlaybooks).set({ status: input.status, approvedByUserId: input.status === "approved" ? input.actorUserId : null, approvedAt: input.status === "approved" ? new Date() : null }).where(eq(customerBotPlaybooks.id, playbook.id));
  return playbook;
}

export async function setTestCaseStatus(input: { storeId: number; actorUserId: number; testCaseId: number; status: "approved" | "archived" }) {
  const db = await requireDb();
  const [testCase] = await db.select().from(customerBotTestCases).where(and(eq(customerBotTestCases.id, input.testCaseId), eq(customerBotTestCases.storeId, input.storeId))).limit(1);
  if (!testCase) throw new Error("حالة الاختبار غير موجودة في المتجر الحالي.");
  await db.update(customerBotTestCases).set({ status: input.status }).where(eq(customerBotTestCases.id, testCase.id));
  return testCase;
}
