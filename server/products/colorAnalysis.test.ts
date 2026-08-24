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
      overallReviewNote: "اقتراح للمراجعة فقط",
    });
  });

  it("يعيد اقتراح مراجعة بصريًا عند عودة JSON غير مكتمل من النموذج", async () => {
    const llm = await import("../_core/llm");
    vi.mocked(llm.invokeLLM).mockResolvedValueOnce({ choices: [{ message: { content: '{"colorGroups":[' } }] } as never);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    const result = await analyzeStoredProductColors({
      productCode: "HJB-FALLBACK-001",
      media: [{ id: 12, storageKey: "products/fallback.webp", originalFileName: "fallback.webp" }],
    });
    expect(result.colorGroups).toHaveLength(1);
    expect(result.colorGroups[0]).toMatchObject({ colorNameArabic: "عنابي", mediaIds: [12], confidence: 0.45 });
    expect(result.overallReviewNote).toContain("اقتراحات بصرية");
  });
});
