import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CustomerBot historical learning review flow", () => {
  it("offers a real extraction action and explicitly keeps candidates as drafts", () => {
    const source = readFileSync(new URL("./CustomerBot.tsx", import.meta.url), "utf8");
    expect(source).toContain("customerBot.extractHistoricalCandidates.useMutation");
    expect(source).toContain("استخراج من التاريخ");
    expect(source).toContain("ولا يعتمدها Bot-H3 أو يستخدمها تلقائياً");
    expect(source).toContain("article.source === \"historical_candidate\"");
    expect(source).toContain("historicalChannels");
    expect(source).toContain("channels: historicalChannels");
  });
});
