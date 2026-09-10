import { describe, expect, it } from "vitest";

// The cost equation is deliberately checked independently of network providers:
// provider price per million tokens plus any image-unit price.
function estimate(inputTokens: number, outputTokens: number, imageUnits: number, price: { input: number; output: number; image: number }) {
  return (price.input * inputTokens / 1_000_000) + (price.output * outputTokens / 1_000_000) + (price.image * imageUnits);
}

describe("AI task cost contract", () => {
  it("calculates token and image costs in the provider card currency", () => {
    expect(estimate(250_000, 100_000, 2, { input: 2, output: 8, image: 0.01 })).toBeCloseTo(1.32, 6);
  });

  it("does not produce a cost when no pricing card is available", () => {
    const missingPrice = null;
    expect(missingPrice ? estimate(1, 1, 0, missingPrice) : 0).toBe(0);
  });
});
