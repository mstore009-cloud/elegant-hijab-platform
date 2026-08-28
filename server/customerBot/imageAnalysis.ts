import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import {
  customerBotImageAnalyses,
  customerBotImageMatches,
  inboxMessageMedia,
  inboxMessages,
  productMedia,
  productVariants,
  products,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { invokeLLM, listLLMModels, type InvokeParams, type InvokeResult } from "../_core/llm";
import { storageGetSignedUrl } from "../storage";

type LlmInvoker = (params: InvokeParams) => Promise<InvokeResult>;

const analysisSchema = z.object({
  garmentType: z.string().trim().max(120),
  dominantColor: z.string().trim().max(80),
  secondaryColors: z.array(z.string().trim().max(80)).max(5),
  pattern: z.string().trim().max(160),
  detectedText: z.string().trim().max(500),
  visualSummary: z.string().trim().min(1).max(1500),
  suitableForMatching: z.boolean(),
  confidence: z.number().min(0).max(100),
});

const matchSchema = z.object({
  matches: z.array(z.object({ productCode: z.string().trim().min(1).max(100), confidence: z.number().min(0).max(100), reason: z.string().trim().min(1).max(300) })).max(3),
});

export type CustomerImageFacts = {
  status: "completed" | "failed" | "pending" | "not_applicable";
  confidence: number | null;
  garmentType: string | null;
  dominantColor: string | null;
  secondaryColors: string[];
  pattern: string | null;
  detectedText: string | null;
  visualSummary: string | null;
  suitableForMatching: boolean;
  matches: Array<{ productCode: string; name: string; sellingPrice: string; colorNames: string[]; confidence: number; reason: string }>;
};

function replyText(result: InvokeResult) {
  const content = result.choices[0]?.message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter(part => part.type === "text").map(part => part.text).join("\n");
  return "";
}

function safeJson<T>(value: string, schema: z.ZodType<T>, errorMessage: string) {
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    throw new Error(errorMessage);
  }
}

function compactError(error: unknown) {
  return (error instanceof Error ? error.message : "تعذر تحليل صورة الزبون.").slice(0, 500);
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

async function resolveVisionModel() {
  const models = await listLLMModels();
  const model = models.data.find(item => item.id === "gemini-3-flash-preview")?.id ?? models.data.find(item => item.id.startsWith("gemini-"))?.id;
  if (!model) throw new Error("لا يتوفر نموذج رؤية لتحليل صور العملاء حاليًا.");
  return model;
}

async function loadScopedMedia(db: any, storeId: number, mediaId: number) {
  const [media] = await db.select().from(inboxMessageMedia).where(and(eq(inboxMessageMedia.id, mediaId), eq(inboxMessageMedia.storeId, storeId))).limit(1);
  if (!media) throw new Error("صورة الرسالة غير موجودة في المتجر التشغيلي الحالي.");
  if (media.mediaType !== "image" || media.downloadStatus !== "stored" || !media.storageKey) throw new Error("الصورة غير جاهزة للتحليل؛ تحقق من اكتمال تخزينها أولاً.");
  const [message] = await db.select({ id: inboxMessages.id }).from(inboxMessages).where(eq(inboxMessages.id, media.messageId)).limit(1);
  if (!message) throw new Error("رسالة الصورة غير موجودة.");
  return { media, message };
}

async function loadProductCandidates(db: any, storeId: number) {
  type Candidate = { id: number; productCode: string; name: string; category: string; description: string | null; sellingPrice: string };
  type CandidateMedia = { id: number; productId: number; storageKey: string | null; sortOrder: number };
  type CandidateVariant = { productId: number; colorName: string };
  const candidates: Candidate[] = await db.select({ id: products.id, productCode: products.productCode, name: products.name, category: products.category, description: products.description, sellingPrice: products.sellingPrice })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.status, "active")))
    .orderBy(desc(products.updatedAt))
    .limit(8);
  if (!candidates.length) return [];
  const ids = candidates.map(candidate => candidate.id);
  const [mediaRows, variantRows]: [CandidateMedia[], CandidateVariant[]] = await Promise.all([
    db.select({ id: productMedia.id, productId: productMedia.productId, storageKey: productMedia.storageKey, sortOrder: productMedia.sortOrder })
      .from(productMedia)
      .where(and(inArray(productMedia.productId, ids), eq(productMedia.mediaType, "image"), isNotNull(productMedia.storageKey)))
      .orderBy(productMedia.sortOrder, productMedia.id),
    db.select({ productId: productVariants.productId, colorName: productVariants.colorName })
      .from(productVariants)
      .where(inArray(productVariants.productId, ids)),
  ]);
  const mediaByProduct = new Map<number, { id: number; storageKey: string }>();
  for (const media of mediaRows) if (media.storageKey && !mediaByProduct.has(media.productId)) mediaByProduct.set(media.productId, { id: media.id, storageKey: media.storageKey });
  return candidates.flatMap(candidate => {
    const representative = mediaByProduct.get(candidate.id);
    if (!representative) return [];
    return [{ ...candidate, representative, colorNames: Array.from(new Set(variantRows.filter(row => row.productId === candidate.id).map(row => row.colorName))).slice(0, 8) }];
  });
}

async function saveAnalysisResult(db: any, input: { storeId: number; mediaId: number; sourceMessageId: number; model: string; result: z.infer<typeof analysisSchema> }) {
  const values = {
    storeId: input.storeId,
    mediaId: input.mediaId,
    sourceMessageId: input.sourceMessageId,
    status: "completed" as const,
    model: input.model,
    confidence: Math.round(input.result.confidence),
    garmentType: input.result.garmentType || null,
    dominantColor: input.result.dominantColor || null,
    secondaryColors: JSON.stringify(input.result.secondaryColors),
    pattern: input.result.pattern || null,
    detectedText: input.result.detectedText || null,
    visualSummary: input.result.visualSummary,
    suitableForMatching: input.result.suitableForMatching,
    errorSummary: null,
  };
  const [existing] = await db.select().from(customerBotImageAnalyses).where(and(eq(customerBotImageAnalyses.storeId, input.storeId), eq(customerBotImageAnalyses.mediaId, input.mediaId))).limit(1);
  if (existing) {
    await db.update(customerBotImageAnalyses).set(values).where(eq(customerBotImageAnalyses.id, existing.id));
    return existing.id;
  }
  const result = await db.insert(customerBotImageAnalyses).values(values);
  return Number(result[0].insertId);
}

/** Analyzes a stored customer image and returns conservative, store-scoped product candidates for human review. */
export async function analyzeCustomerMessageImage(input: { storeId: number; mediaId: number; llm?: LlmInvoker; visionModel?: string; getSignedUrl?: (key: string) => Promise<string> }) {
  const db = await requireDb();
  const { media, message } = await loadScopedMedia(db, input.storeId, input.mediaId);
  const model = input.visionModel ?? await resolveVisionModel();
  const llm = input.llm ?? invokeLLM;
  const getSignedUrl = input.getSignedUrl ?? storageGetSignedUrl;
  let analysisId: number | null = null;
  try {
    const imageUrl = await getSignedUrl(media.storageKey!);
    const analysisResponse = await llm({
      model,
      max_tokens: 1800,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "أنت محلل صور أزياء محافظ لمتجر حجابات. حلل القطعة الظاهرة فقط، وتجاهل الأشخاص والخلفية. لا تحدد منتجاً بعينه ولا تخترع تفاصيل غير مرئية. أرجع JSON مطابقاً للمخطط." },
          { type: "image_url", image_url: { url: imageUrl, detail: "auto" } },
        ],
      }],
      response_format: { type: "json_schema", json_schema: { name: "customer_image_analysis", strict: true, schema: { type: "object", properties: { garmentType: { type: "string" }, dominantColor: { type: "string" }, secondaryColors: { type: "array", items: { type: "string" } }, pattern: { type: "string" }, detectedText: { type: "string" }, visualSummary: { type: "string" }, suitableForMatching: { type: "boolean" }, confidence: { type: "number" } }, required: ["garmentType", "dominantColor", "secondaryColors", "pattern", "detectedText", "visualSummary", "suitableForMatching", "confidence"], additionalProperties: false } } },
    });
    const result = safeJson(replyText(analysisResponse), analysisSchema, "لم يرجع محلل الصورة نتيجة منظمة قابلة للمراجعة.");
    const savedAnalysisId = await saveAnalysisResult(db, { storeId: input.storeId, mediaId: media.id, sourceMessageId: message.id, model, result });
    analysisId = savedAnalysisId;
    await db.delete(customerBotImageMatches).where(and(eq(customerBotImageMatches.storeId, input.storeId), eq(customerBotImageMatches.analysisId, savedAnalysisId)));
    if (!result.suitableForMatching || result.confidence < 60) return { analysisId: savedAnalysisId, status: "completed" as const, matchCount: 0 };

    const candidates = await loadProductCandidates(db, input.storeId);
    if (!candidates.length) return { analysisId: savedAnalysisId, status: "completed" as const, matchCount: 0 };
    const candidateUrls = await Promise.all(candidates.map(async candidate => ({ ...candidate, imageUrl: await getSignedUrl(candidate.representative.storageKey) })));
    const matchResponse = await llm({
      model,
      max_tokens: 1800,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `قارن صورة عميلة مع صور مرجعية لمنتجات المتجر. لا تعتبر التشابه إثباتاً للهوية. أرجع حتى 3 مرشحين فقط إذا كانت الثقة 60 أو أعلى. صورة العميل أولاً، ثم صور المنتجات بالترتيب: ${candidateUrls.map((candidate, index) => `${index + 1}) الرمز ${candidate.productCode}، الاسم ${candidate.name}، الفئة ${candidate.category}، الألوان ${candidate.colorNames.join("، ") || "غير محددة"}.`).join(" ")}` },
          { type: "image_url", image_url: { url: imageUrl, detail: "auto" } },
          ...candidateUrls.map(candidate => ({ type: "image_url" as const, image_url: { url: candidate.imageUrl, detail: "auto" as const } })),
        ],
      }],
      response_format: { type: "json_schema", json_schema: { name: "customer_image_matches", strict: true, schema: { type: "object", properties: { matches: { type: "array", items: { type: "object", properties: { productCode: { type: "string" }, confidence: { type: "number" }, reason: { type: "string" } }, required: ["productCode", "confidence", "reason"], additionalProperties: false } } }, required: ["matches"], additionalProperties: false } } },
    });
    const matches = safeJson(replyText(matchResponse), matchSchema, "لم يرجع محلل الصورة مطابقات منظمة قابلة للمراجعة.").matches;
    const known = new Map(candidateUrls.map(candidate => [candidate.productCode, candidate]));
    const accepted = matches.filter(match => match.confidence >= 60 && known.has(match.productCode)).sort((left, right) => right.confidence - left.confidence).slice(0, 3);
    if (accepted.length) await db.insert(customerBotImageMatches).values(accepted.map((match, index) => {
      const candidate = known.get(match.productCode)!;
      return { storeId: input.storeId, analysisId: savedAnalysisId, productId: candidate.id, productMediaId: candidate.representative.id, rank: index + 1, confidence: Math.round(match.confidence), matchReason: match.reason };
    }));
    return { analysisId: savedAnalysisId, status: "completed" as const, matchCount: accepted.length };
  } catch (error) {
    const errorSummary = compactError(error);
    const [existing] = await db.select().from(customerBotImageAnalyses).where(and(eq(customerBotImageAnalyses.storeId, input.storeId), eq(customerBotImageAnalyses.mediaId, input.mediaId))).limit(1);
    if (existing) await db.update(customerBotImageAnalyses).set({ status: "failed", errorSummary }).where(eq(customerBotImageAnalyses.id, existing.id));
    else await db.insert(customerBotImageAnalyses).values({ storeId: input.storeId, mediaId: media.id, sourceMessageId: message.id, status: "failed", errorSummary, suitableForMatching: false });
    return { analysisId, status: "failed" as const, matchCount: 0, errorSummary };
  }
}

function parseColors(raw: string | null) {
  try { return z.array(z.string()).parse(JSON.parse(raw ?? "[]")); } catch { return []; }
}

/** Safe image facts for a Bot-H1/H2 prompt; storage keys, customer image URLs, cost, and margin never leave the service. */
export async function listCustomerImageFacts(storeId: number, sourceMessageId: number): Promise<CustomerImageFacts[]> {
  const db = await requireDb();
  const analyses = await db.select().from(customerBotImageAnalyses).where(and(eq(customerBotImageAnalyses.storeId, storeId), eq(customerBotImageAnalyses.sourceMessageId, sourceMessageId))).orderBy(desc(customerBotImageAnalyses.createdAt));
  if (!analyses.length) return [];
  const analysisIds = analyses.map(analysis => analysis.id);
  const matches = await db.select({ analysisId: customerBotImageMatches.analysisId, confidence: customerBotImageMatches.confidence, matchReason: customerBotImageMatches.matchReason, productCode: products.productCode, name: products.name, sellingPrice: products.sellingPrice, productId: products.id })
    .from(customerBotImageMatches)
    .innerJoin(products, eq(customerBotImageMatches.productId, products.id))
    .where(and(eq(customerBotImageMatches.storeId, storeId), inArray(customerBotImageMatches.analysisId, analysisIds), eq(products.storeId, storeId)))
    .orderBy(customerBotImageMatches.rank);
  const productIds = Array.from(new Set(matches.map(match => match.productId)));
  const variants = productIds.length ? await db.select({ productId: productVariants.productId, colorName: productVariants.colorName }).from(productVariants).where(inArray(productVariants.productId, productIds)) : [];
  return analyses.map(analysis => ({
    status: analysis.status,
    confidence: analysis.confidence,
    garmentType: analysis.garmentType,
    dominantColor: analysis.dominantColor,
    secondaryColors: parseColors(analysis.secondaryColors),
    pattern: analysis.pattern,
    detectedText: analysis.detectedText,
    visualSummary: analysis.visualSummary,
    suitableForMatching: analysis.suitableForMatching,
    matches: matches.filter(match => match.analysisId === analysis.id).map(match => ({ productCode: match.productCode, name: match.name, sellingPrice: match.sellingPrice, colorNames: Array.from(new Set(variants.filter(variant => variant.productId === match.productId).map(variant => variant.colorName))), confidence: match.confidence, reason: match.matchReason })),
  }));
}
