import { z } from "zod";
import { invokeLLM, listLLMModels } from "../_core/llm";
import { storageGetSignedUrl } from "../storage";

const analysisSchema = z.object({
  colorGroups: z.array(z.object({
    colorNameArabic: z.string().trim().min(1).max(80),
    confidence: z.number().min(0).max(1),
    mediaIds: z.array(z.number().int().positive()).min(1),
    reviewNote: z.string().max(300),
  })).max(20),
  uncertainMediaIds: z.array(z.number().int().positive()).max(100),
  overallReviewNote: z.string().max(500),
});

export type ProductColorSuggestion = z.infer<typeof analysisSchema>;

export async function analyzeStoredProductColors(input: {
  productCode: string;
  media: Array<{ id: number; storageKey: string | null; originalFileName: string | null }>;
}): Promise<ProductColorSuggestion> {
  const analyzableMedia = input.media.filter(item => item.storageKey);
  if (analyzableMedia.length === 0) throw new Error("لا توجد صور تشغيلية محفوظة لتحليل الألوان. أضف صورة أو أنشئ WebP أولًا.");
  const mediaUrls = await Promise.all(analyzableMedia.slice(0, 12).map(async item => ({
    id: item.id,
    name: item.originalFileName ?? `صورة ${item.id}`,
    url: await storageGetSignedUrl(item.storageKey!),
  })));
  const models = await listLLMModels();
  const visionModel = models.data.find(model => model.id === "gemini-3-flash-preview")?.id
    ?? models.data.find(model => model.id.startsWith("gemini-"))?.id;
  if (!visionModel) throw new Error("لا يتوفر نموذج بصري لتحليل الصور حاليًا.");
  const response = await invokeLLM({
    model: visionModel,
    max_tokens: 1800,
    messages: [
      {
        role: "system",
        content: "أنت محلل كتالوج أزياء حذر. اقترح لون القماش الرئيسي فقط، وتجاهل الخلفية والبشرة والإضاءة والظلال. اجمع الصور التي تمثل اللون نفسه. لا تعتمد لونًا ولا تخمّن عند الشك؛ ضع معرف الصورة ضمن uncertainMediaIds.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `حلل ألوان صور المنتج ${input.productCode}. الصور المعروضة بالترتيب: ${mediaUrls.map(item => `${item.id}: ${item.name}`).join("، ")}. أرجع أسماء عربية قصيرة.` },
          ...mediaUrls.map(item => ({ type: "image_url" as const, image_url: { url: item.url, detail: "low" as const } })),
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
            colorGroups: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  colorNameArabic: { type: "string" },
                  confidence: { type: "number" },
                  mediaIds: { type: "array", items: { type: "integer" } },
                  reviewNote: { type: "string" },
                },
                required: ["colorNameArabic", "confidence", "mediaIds", "reviewNote"],
                additionalProperties: false,
              },
            },
            uncertainMediaIds: { type: "array", items: { type: "integer" } },
            overallReviewNote: { type: "string" },
          },
          required: ["colorGroups", "uncertainMediaIds", "overallReviewNote"],
          additionalProperties: false,
        },
      },
    },
  });
  const raw = response.choices[0]?.message.content;
  if (typeof raw !== "string") throw new Error("لم يرجع محلل الصور نتيجة قابلة للمراجعة.");
  const parsed = analysisSchema.parse(JSON.parse(raw));
  const knownIds = new Set(mediaUrls.map(item => item.id));
  if ([...parsed.colorGroups.flatMap(group => group.mediaIds), ...parsed.uncertainMediaIds].some(id => !knownIds.has(id))) {
    throw new Error("نتيجة التحليل أشارت إلى صورة غير موجودة في المنتج.");
  }
  return parsed;
}
