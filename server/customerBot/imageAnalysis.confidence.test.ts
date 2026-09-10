import { describe, expect, it } from "vitest";
import { normalizeVisionConfidence } from "./imageAnalysis";

describe("normalizeVisionConfidence", () => {
  it("converts fractional vision confidence to percentage", () => {
    expect(normalizeVisionConfidence(0.86)).toBe(86);
    expect(normalizeVisionConfidence(1)).toBe(100);
  });

  it("keeps percentage confidence and clamps invalid extremes", () => {
    expect(normalizeVisionConfidence(86)).toBe(86);
    expect(normalizeVisionConfidence(-4)).toBe(0);
    expect(normalizeVisionConfidence(140)).toBe(100);
  });
});
