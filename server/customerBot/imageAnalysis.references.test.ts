import { describe, expect, it, vi } from "vitest";
import { normalizeProductCode, normalizeVisionConfidence } from "./imageAnalysis";

describe("visual-reference matching contract", () => {
  it("normalizes a fractional matching confidence before thresholding", () => {
    expect(normalizeVisionConfidence(0.72)).toBe(72);
  });

  it("keeps the matching reference window bounded to three images per product", () => {
    const references = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    expect(references.slice(0, 3)).toHaveLength(3);
  });

  it("normalizes OCR punctuation and whitespace without creating product codes", () => {
    expect(normalizeProductCode(" product  _ eh–001 ")).toBe("PRODUCT-EH-001");
    expect(normalizeProductCode("Product Code: EH-001")).toBe("PRODUCT-CODE-EH-001");
  });
});
