import { describe, expect, it, vi } from "vitest";

vi.mock("../_core/llm", () => ({
  listLLMModels: vi.fn(async () => ({ data: [{ id: "gemini-3-flash-preview" }] })),
  invokeLLM: vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify({
    colorGroups: [{ colorNameArabic: "عنابي", confidence: 0.91, mediaIds: [11], reviewNote: "لون القماش ظاهر بوضوح" }],
    uncertainMediaIds: [],
    overallReviewNote: "اقتراح للمراجعة فقط",
  }) } }] })),
}));
vi.mock("../storage", () => ({ storageGetSignedUrl: vi.fn(async (key: string) => `https://example.test/${key}`) }));
vi.mock("sharp", () => ({
  default: vi.fn(() => ({
    resize: vi.fn(() => ({
      stats: vi.fn(async () => ({ dominant: { r: 119, g: 31, b: 43 } })),
    })),
  })),
}));

import { analyzeStoredProductColors } from "./colorAnalysis";

describe("تحليل ألوان صور المنتج", () => {
  it("يعيد اقتراحًا منظمًا للصور التشغيلية ولا يعتمد لونًا أو مخزونًا", async () => {
    const result = await analyzeStoredProductColors({
      productCode: "HJB-TEST-001",
      media: [{ id: 11, storageKey: "products/test.webp", originalFileName: "test.webp" }],
    });
    expect(result).toEqual({
      colorGroups: [{ colorNameArabic: "عنابي", confidence: 0.91, mediaIds: [11], reviewNote: "لون القماش ظاهر بوضوح" }],
      uncertainMediaIds: [],
      overallReviewNote: "اقتراح بصري مجمع من 1 دفعات خادمية متسلسلة؛ راجعه قبل الاعتماد.",
    });
  });

  it("يعيد المحاولة البصرية عند عودة JSON غير مكتمل ولا يحفظ بديلًا لونيًا مضللًا", async () => {
    const llm = await import("../_core/llm");
    vi.mocked(llm.invokeLLM)
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"colorGroups":[' } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({
        colorGroups: [{ colorNameArabic: "زيتي", confidence: 0.86, mediaIds: [12], reviewNote: "لون القماش واضح" }],
        uncertainMediaIds: [],
        overallReviewNote: "نتيجة إعادة المحاولة",
      }) } }] } as never);
    const result = await analyzeStoredProductColors({
      productCode: "HJB-FALLBACK-001",
      media: [{ id: 12, storageKey: "products/fallback.webp", originalFileName: "fallback.webp" }],
    });
    expect(result.colorGroups).toHaveLength(1);
    expect(result.colorGroups[0]).toMatchObject({ colorNameArabic: "زيتي", mediaIds: [12], confidence: 0.86 });
    expect(vi.mocked(llm.invokeLLM)).toHaveBeenCalledTimes(3);
    expect(result.overallReviewNote).toContain("دفعات خادمية متسلسلة");
  });

  it("يحلل أكثر من اثنتي عشرة صورة في دفعات متسلسلة ويدمج كل معرّف مرة واحدة", async () => {
    const llm = await import("../_core/llm");
    const invokeMock = vi.mocked(llm.invokeLLM);
    const callsBefore = invokeMock.mock.calls.length;
    invokeMock
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({
        colorGroups: [
          { colorNameArabic: "بني", confidence: 0.9, mediaIds: [1, 2, 3, 4], reviewNote: "بني واضح" },
          { colorNameArabic: "بيج", confidence: 0.8, mediaIds: [5, 6, 7, 8], reviewNote: "بيج واضح" },
        ],
        uncertainMediaIds: [],
        overallReviewNote: "الدفعة الأولى",
      }) } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({
        colorGroups: [{ colorNameArabic: "بني", confidence: 0.6, mediaIds: [9, 10], reviewNote: "بني إضافي" }],
        uncertainMediaIds: [11, 12, 13],
        overallReviewNote: "الدفعة الثانية",
      }) } }] } as never);

    const result = await analyzeStoredProductColors({
      productCode: "HJB-BATCH-013",
      media: Array.from({ length: 13 }, (_, index) => ({ id: index + 1, storageKey: `products/${index + 1}.webp`, originalFileName: `${index + 1}.webp` })),
    });

    expect(invokeMock.mock.calls).toHaveLength(callsBefore + 2);
    expect(result.colorGroups).toEqual([
      { colorNameArabic: "بني", confidence: 0.8, mediaIds: [1, 2, 3, 4, 9, 10], reviewNote: "بني واضح؛ بني إضافي" },
      { colorNameArabic: "بيج", confidence: 0.8, mediaIds: [5, 6, 7, 8], reviewNote: "بيج واضح" },
    ]);
    expect(result.uncertainMediaIds).toEqual([11, 12, 13]);
    expect([...result.colorGroups.flatMap(group => group.mediaIds), ...result.uncertainMediaIds].sort((a, b) => a - b)).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
  });
});
