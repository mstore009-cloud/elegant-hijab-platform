import { describe, expect, it } from "vitest";
import { isEligibleForOperationalRegeneration, planOperationalReferenceDetach, selectForcedOperationalRegenerationCandidates, selectOperationalRegenerationCandidates } from "./operationalMediaLifecycle";

describe("دورة حياة النسخ التشغيلية", () => {
  it("تختار لإعادة التوليد مرجع صورة OneDrive فقط عندما تكون النسخة التشغيلية غير موجودة", () => {
    const candidates = selectOperationalRegenerationCandidates([
      { id: 1, variantId: 1, source: "onedrive", mediaType: "image", originalFileName: "wine.jpg", storageKey: null },
      { id: 2, variantId: 2, source: "onedrive", mediaType: "image", originalFileName: "olive.jpg", storageKey: "products/1/olive.webp" },
      { id: 3, variantId: null, source: "manual", mediaType: "image", originalFileName: "manual.jpg", storageKey: null },
      { id: 4, variantId: null, source: "onedrive", mediaType: "document", originalFileName: "notes.txt", storageKey: null },
    ] as const);

    expect(candidates.map(candidate => candidate.id)).toEqual([1]);
    expect(isEligibleForOperationalRegeneration(candidates[0]!)).toBe(true);
  });

  it("يسمح بفصل مرجع OneDrive من دون إعادة كشف مفتاح التخزين في نتيجة الخطة", () => {
    expect(planOperationalReferenceDetach({
      id: 7,
      variantId: 3,
      source: "onedrive",
      mediaType: "image",
      originalFileName: "wine.jpg",
      storageKey: "products/1/operational/7.webp",
    })).toEqual({ mediaId: 7, releasedOperationalCopy: true });
  });

  it("يختار إعادة توليد قسرية لمرجع محدد حتى عند وجود WebP قديمة", () => {
    const candidates = selectForcedOperationalRegenerationCandidates([
      { id: 9, variantId: 3, source: "onedrive", mediaType: "image", originalFileName: "wine.jpg", storageKey: "products/1/wine.webp" },
      { id: 10, variantId: 4, source: "onedrive", mediaType: "image", originalFileName: "olive.jpg", storageKey: "products/1/olive.webp" },
    ], 10);

    expect(candidates.map(candidate => candidate.id)).toEqual([10]);
  });

  it("يرفض استخدام دورة حياة OneDrive لفصل وسيط يدوي", () => {
    expect(() => planOperationalReferenceDetach({
      id: 8,
      variantId: null,
      source: "manual",
      mediaType: "image",
      originalFileName: "manual.jpg",
      storageKey: null,
    })).toThrow("دورة حياة صور OneDrive");
  });
});
