import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Inbox rich Meta message context", () => {
  it("renders useful message context without raw payloads or redundant technical labels", () => {
    const inbox = readFileSync(new URL("../components/inbox/NativeInbox.tsx", import.meta.url), "utf8");
    const media = readFileSync(new URL("../components/inbox/ThreadMedia.tsx", import.meta.url), "utf8");
    expect(inbox).toContain("message.metadata?.replyToExternalMessageId");
    expect(inbox).toContain("رد على رسالة");
    expect(inbox).toContain("message.deliveryStatus");
    expect(inbox).toContain("reactions");
    expect(inbox).not.toContain("نوع الرسالة");
    expect(inbox).not.toContain("مرفقات فقط");
    expect(media).toContain("<audio src={item.url}");
    expect(media).toContain("<img src={item.url}");
    expect(media).not.toContain("مرفق");
    expect(inbox).not.toContain("access_token");
  });
});
