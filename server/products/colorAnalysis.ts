import { z } from "zod";
import sharp from "sharp";
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

function fallbackColorName({ r, g, b }: { r: number; g: number; b: number }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 510;
  if (delta < 20) {
    if (lightness > 0.78) return "أبيض";
    if (lightness < 0.22) return "أسود";
    return "رمادي";
  }
  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (lightness < 0.38 && (hue >= 330 || hue < 25)) return "عنابي";
  if (hue < 18 || hue >= 345) return "أحمر";
  if (hue < 48) return lightness < 0.45 ? "بني" : "بيج";
  if (hue < 78) return "أصفر";
  if (hue < 170) return lightness < 0.42 ? "زيتي" : "أخضر";
  if (hue < 250) return "أزرق";
  if (hue < 315) return "بنفسجي";
  return "وردي";
}

async function analyzeWithVisualFallback(mediaUrls: Array<{ id: number; url: string }>): Promise<ProductColorSuggestion> {
  const groups = new Map<string, number[]>();
  const uncertainMediaIds: number[] = [];
  await Promise.all(mediaUrls.map(async media => {
    try {
      const response = await fetch(media.url);
      if (!response.ok) throw new Error("unavailable image");
      const { dominant } = await sharp(Buffer.from(await response.arrayBuffer())).resize(96, 96, { fit: "inside" }).stats();
      const color = fallbackColorName(dominant);
      groups.set(color, [...(groups.get(color) ?? []), media.id]);
    } catch {
      uncertainMediaIds.push(media.id);
    }
  }));
  return {
    colorGroups: Array.from(groups.entries()).map(([colorNameArabic, mediaIds]) => ({
      colorNameArabic,
      confidence: 0.45,
      mediaIds,
      reviewNote: "اقتراح أولي من ألوان الصورة التشغيلية؛ راجعه قبل الاعتماد.",
    })),
    uncertainMediaIds,
    overallReviewNote: "تعذر إكمال التحليل الذكي؛ هذه اقتراحات بصرية أولية للمراجعة فقط.",
  };
}

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
  try {
    const response = await invokeLLM({
      model: visionModel,
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: "أنت محلل كتالوج أزياء حذر. اقترح لون القماش الرئيسي فقط، وتجاهل الخلفية والبشرة والإضاءة والظلال. اجمع الصور التي تمثل اللون نفسه. لا تعتمد لونًا ولا تخمّن عند الشك؛ ضع معرف الصورة ضمن uncertainMediaIds. أرجع JSON صالحًا فقط.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `حلل ألوان صور المنتج ${input.productCode}. الصور المعروضة بالترتيب: ${mediaUrls.map(item => `${item.id}: ${item.name}`).join("، ")}. اجعل الملاحظة قصيرة جدًا.` },
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
    const raw = response.choices[0]?.message.content;
    if (typeof raw !== "string") throw new Error("لم يرجع محلل الصور نتيجة قابلة للمراجعة.");
    const parsed = analysisSchema.parse(JSON.parse(raw));
    const knownIds = new Set(mediaUrls.map(item => item.id));
    if ([...parsed.colorGroups.flatMap(group => group.mediaIds), ...parsed.uncertainMediaIds].some(id => !knownIds.has(id))) throw new Error("نتيجة التحليل أشارت إلى صورة غير موجودة في المنتج.");
    return parsed;
  } catch {
    return analyzeWithVisualFallback(mediaUrls);
  }
}
