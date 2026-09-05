import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Inbox Bot-H3 decision visibility", () => {
  it("projects derived channel health without exposing the bot model or knowledge sources in the thread", () => {
    const source = readFileSync(new URL("../components/inbox/NativeInbox.tsx", import.meta.url), "utf8");
    expect(source).toContain("current?.channelHealth?.sendReady");
    expect(source).toContain("الإرسال غير متاح للقناة حالياً");
    expect(source).not.toContain("مصادر المعرفة");
    expect(source).not.toContain("النموذج:");
  });

  it("refreshes the authenticated Inbox path whenever a live event is received", () => {
    const source = readFileSync(new URL("../components/inbox/NativeInbox.tsx", import.meta.url), "utf8");
    expect(source).toContain("utils.inbox.list.invalidate()");
    expect(source).toContain("utils.inbox.detail.invalidate()");
    expect(source).toContain("onInboxMessage: refresh");
  });
});
