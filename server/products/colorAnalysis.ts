import { z } from "zod";
import { invokeLLM, listLLMModels } from "../_core/llm";
import { storageGetSignedUrl } from "../storage";

const analysisSchema = z.object({
  colorGroups: z.array(z.object({
    colorNameArabic: z.string().trim().min(1).max(80),
    confidence: z.number().min(0).max(1),
    mediaIds: z.array(z.number().int().positive()).min(1),
    reviewNote: z.string().max(300),
  })).max(100),
  uncertainMediaIds: z.array(z.number().int().positive()).max(200),
  overallReviewNote: z.string().max(500),
});

export type ProductColorSuggestion = z.infer<typeof analysisSchema>;

type AnalyzableImage = { id: number; name: string; url: string };

const IMAGES_PER_VISION_BATCH = 8;
const MAX_VISION_BATCHES_PER_PRODUCT = 20;

function parseVisionSuggestion(raw: unknown, mediaUrls: AnalyzableImage[]): ProductColorSuggestion {
  if (typeof raw !== "string") throw new Error("لم يرجع محلل الصور نتيجة قابلة للمراجعة.");
  const parsed = analysisSchema.parse(JSON.parse(raw));
  const knownIds = new Set(mediaUrls.map(item => item.id));
  const assignedIds = [...parsed.colorGroups.flatMap(group => group.mediaIds), ...parsed.uncertainMediaIds];
  if (assignedIds.some(id => !knownIds.has(id))) throw new Error("نتيجة التحليل أشارت إلى صورة غير موجودة في المنتج.");
  if (new Set(assignedIds).size !== assignedIds.length) throw new Error("نتيجة التحليل نسبت الصورة نفسها إلى أكثر من لون.");
  if (assignedIds.length !== knownIds.size) throw new Error("نتيجة التحليل لم تعيّن كل صور الدفعة إلى لون أو إلى غير مؤكد.");
  return parsed;
}

function divideIntoBatches<T>(items: T[], batchSize: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / batchSize) }, (_, index) => items.slice(index * batchSize, (index + 1) * batchSize));
}

function mergeBatchSuggestions(suggestions: ProductColorSuggestion[]): ProductColorSuggestion {
  const groups = new Map<string, { colorNameArabic: string; mediaIds: number[]; weightedConfidence: number; imageCount: number; reviewNotes: string[] }>();
  const uncertainMediaIds: number[] = [];

  for (const suggestion of suggestions) {
    for (const group of suggestion.colorGroups) {
      const colorNameArabic = group.colorNameArabic.trim();
      const key = colorNameArabic.toLocaleLowerCase("ar");
      const existing = groups.get(key) ?? { colorNameArabic, mediaIds: [], weightedConfidence: 0, imageCount: 0, reviewNotes: [] };
      existing.mediaIds.push(...group.mediaIds);
      existing.weightedConfidence += group.confidence * group.mediaIds.length;
      existing.imageCount += group.mediaIds.length;
      if (group.reviewNote.trim()) existing.reviewNotes.push(group.reviewNote.trim());
      groups.set(key, existing);
    }
    uncertainMediaIds.push(...suggestion.uncertainMediaIds);
  }

  const mergedGroups = Array.from(groups.values());
  const allIds = [...mergedGroups.flatMap(group => group.mediaIds), ...uncertainMediaIds];
  if (new Set(allIds).size !== allIds.length) throw new Error("تعذر دمج نتائج الدفعات لأن صورة واحدة تكررت في أكثر من نتيجة.");

  return {
    colorGroups: mergedGroups.map(group => ({
      colorNameArabic: group.colorNameArabic,
      mediaIds: group.mediaIds,
      confidence: Number((group.weightedConfidence / group.imageCount).toFixed(2)),
      reviewNote: Array.from(new Set(group.reviewNotes)).join("؛ ").slice(0, 300) || "اقتراح بصري مجمع للمراجعة.",
    })),
    uncertainMediaIds,
    overallReviewNote: `اقتراح بصري مجمع من ${suggestions.length} دفعات خادمية متسلسلة؛ راجعه قبل الاعتماد.`,
  };
}

async function requestVisionSuggestion(input: {
  model: string;
  productCode: string;
  mediaUrls: AnalyzableImage[];
  maxTokens: number;
  retry: boolean;
}) {
  const response = await invokeLLM({
    model: input.model,
    max_tokens: input.maxTokens,
    messages: [
      {
        role: "system",
        content: input.retry
          ? "أنت محلل كتالوج أزياء دقيق. هذه إعادة محاولة: عيّن كل صورة إلى لون القماش الرئيسي أو إلى غير مؤكد فقط إذا كان لون القماش غير ظاهر. تجاهل الخلفية والبشرة والإضاءة والظلال. أرجع JSON صالحًا مطابقًا للمخطط فقط."
          : "أنت محلل كتالوج أزياء حذر. اقترح لون القماش الرئيسي فقط، وتجاهل الخلفية والبشرة والإضاءة والظلال. اجمع الصور التي تمثل اللون نفسه. لا تعتمد لونًا ولا تخمّن عند الشك؛ ضع معرف الصورة ضمن uncertainMediaIds. أرجع JSON صالحًا فقط.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `حلل ألوان صور المنتج ${input.productCode}. الصور المعروضة بالترتيب: ${input.mediaUrls.map(item => `${item.id}: ${item.name}`).join("، ")}. اجعل الملاحظة قصيرة جدًا.` },
          ...input.mediaUrls.map(item => ({ type: "image_url" as const, image_url: { url: item.url, detail: "auto" as const } })),
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "product_color_suggestions",
        strict: true,
        schema: {
          type: "object",
          properties: {
            colorGroups: { type: "array", items: { type: "object", properties: { colorNameArabic: { type: "string" }, confidence: { type: "number" }, mediaIds: { type: "array", items: { type: "integer" } }, reviewNote: { type: "string" } }, required: ["colorNameArabic", "confidence", "mediaIds", "reviewNote"], additionalProperties: false } },
            uncertainMediaIds: { type: "array", items: { type: "integer" } },
            overallReviewNote: { type: "string" },
          },
          required: ["colorGroups", "uncertainMediaIds", "overallReviewNote"],
          additionalProperties: false,
        },
      },
    },
  });
  return parseVisionSuggestion(response.choices[0]?.message.content, input.mediaUrls);
}

export async function analyzeStoredProductColors(input: {
  productCode: string;
  media: Array<{ id: number; storageKey: string | null; originalFileName: string | null }>;
}): Promise<ProductColorSuggestion> {
  const analyzableMedia = input.media.filter(item => item.storageKey);
  if (analyzableMedia.length === 0) throw new Error("لا توجد صور تشغيلية محفوظة لتحليل الألوان. أضف صورة أو أنشئ WebP أولًا.");
  const mediaBatches = divideIntoBatches(analyzableMedia, IMAGES_PER_VISION_BATCH);
  if (mediaBatches.length > MAX_VISION_BATCHES_PER_PRODUCT) {
    throw new Error(`يتجاوز المنتج حد التحليل الآمن الحالي (${IMAGES_PER_VISION_BATCH * MAX_VISION_BATCHES_PER_PRODUCT} صورة). راجع الصور على دفعات أصغر بدل إنشاء اقتراح جزئي.`);
  }
  const models = await listLLMModels();
  const visionModel = models.data.find(model => model.id === "gemini-3-flash-preview")?.id
    ?? models.data.find(model => model.id.startsWith("gemini-"))?.id;
  if (!visionModel) throw new Error("لا يتوفر نموذج بصري لتحليل الصور حاليًا.");

  const batchSuggestions: ProductColorSuggestion[] = [];
  for (let batchIndex = 0; batchIndex < mediaBatches.length; batchIndex += 1) {
    const batch = mediaBatches[batchIndex];
    const mediaUrls = await Promise.all(batch.map(async item => ({
      id: item.id,
      name: item.originalFileName ?? `صورة ${item.id}`,
      url: await storageGetSignedUrl(item.storageKey!),
    })));
    try {
      batchSuggestions.push(await requestVisionSuggestion({ model: visionModel, productCode: input.productCode, mediaUrls, maxTokens: 4096, retry: false }));
    } catch (firstError) {
      try {
        batchSuggestions.push(await requestVisionSuggestion({ model: visionModel, productCode: input.productCode, mediaUrls, maxTokens: 8192, retry: true }));
      } catch (secondError) {
        const firstMessage = firstError instanceof Error ? firstError.message : "فشل التحليل الأول";
        const secondMessage = secondError instanceof Error ? secondError.message : "فشل التحليل المعاد";
        throw new Error(`تعذر إنشاء اقتراحات ألوان حقيقية للدفعة ${batchIndex + 1} من ${mediaBatches.length} بعد محاولتين: ${firstMessage}; ${secondMessage}`);
      }
    }
  }

  const merged = mergeBatchSuggestions(batchSuggestions);
  const expectedIds = new Set(analyzableMedia.map(item => item.id));
  const mergedIds = [...merged.colorGroups.flatMap(group => group.mediaIds), ...merged.uncertainMediaIds];
  if (mergedIds.length !== expectedIds.size || new Set(mergedIds).size !== mergedIds.length || mergedIds.some(id => !expectedIds.has(id))) {
    throw new Error("تعذر دمج اقتراحات الألوان لأن بعض صور المنتج لم تظهر مرة واحدة فقط في النتيجة النهائية.");
  }
  return merged;
}
