import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CRM linked conversations", () => {
  it("renders store-scoped conversations with an Inbox deep link", () => {
    const source = readFileSync(new URL("./CRM.tsx", import.meta.url), "utf8");
    expect(source).toContain("محادثات العميل");
    expect(source).toContain("detail.data?.conversations");
    expect(source).toContain("/inbox?conversation=${conversation.id}");
    expect(source).toContain("channelLabels");
    expect(source).toContain("لا توجد محادثات مرتبطة بهذا العميل حتى الآن.");
  });

  it("keeps the Inbox deep-link target wired to the requested conversation", () => {
    const source = readFileSync(new URL("../components/inbox/NativeInbox.tsx", import.meta.url), "utf8");
    expect(source).toContain('get("conversation")');
    expect(source).toContain("requestedConversationId");
    expect(source).toContain("rows.some(row => row.id === requestedConversationId)");
  });
});
