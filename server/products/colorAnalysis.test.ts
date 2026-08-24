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
      overallReviewNote: "اقتراح للمراجعة فقط",
    });
  });
});
