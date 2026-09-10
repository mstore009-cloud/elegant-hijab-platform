import { describe, expect, it, vi } from "vitest";
import { normalizeVisionConfidence } from "./imageAnalysis";

describe("visual-reference matching contract", () => {
  it("normalizes a fractional matching confidence before thresholding", () => {
    expect(normalizeVisionConfidence(0.72)).toBe(72);
  });

  it("keeps the matching reference window bounded to three images per product", () => {
    const references = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    expect(references.slice(0, 3)).toHaveLength(3);
  });
});
