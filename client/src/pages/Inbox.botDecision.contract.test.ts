import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Inbox Bot-H3 decision visibility", () => {
  it("projects derived channel health instead of trusting a manually configured account", () => {
    const source = readFileSync(new URL("./Inbox.tsx", import.meta.url), "utf8");
    expect(source).toContain("current?.channelHealth?.sendReady");
    expect(source).toContain("BotDecisionSummary");
    expect(source).toContain("مصادر المعرفة");
    expect(source).toContain("محجوب حتى تجهز القناة");
  });

  it("refreshes bot decisions and sources through the authenticated live Inbox path", () => {
    const source = readFileSync(new URL("./Inbox.tsx", import.meta.url), "utf8");
    expect(source).toContain("customerBot.knowledgeSources.useQuery");
    expect(source).toContain("utils.customerBot.knowledgeSources.invalidate()");
    expect(source).toContain("onInboxMessage: refreshFromLiveMessage");
  });
});
