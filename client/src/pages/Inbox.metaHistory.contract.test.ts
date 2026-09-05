import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./Inbox.tsx", import.meta.url), "utf8");
const nativeInbox = readFileSync(new URL("../components/inbox/NativeInbox.tsx", import.meta.url), "utf8");

describe("Inbox Meta history and live-update experience", () => {
  it("يبقي حالة المزامنة في صفحة Meta المتخصصة ولا يزاحم محادثات الموظف بها", () => {
    expect(pageSource).toContain("NativeInbox");
    expect(nativeInbox).not.toContain("historyProgress");
    expect(nativeInbox).not.toContain("بانتظار اختيار أصول الرسائل");
    expect(nativeInbox).not.toContain("عرض الربط والتقدم");
  });

  it("uses server push with a lightweight fallback refresh", () => {
    expect(nativeInbox).toContain("const REALTIME_REFRESH_MS = 30_000;");
    expect(nativeInbox).toContain("refetchInterval: REALTIME_REFRESH_MS");
    expect(nativeInbox).toContain("refetchOnWindowFocus: true");
    expect(nativeInbox).toContain("useInboxLiveUpdates");
  });

  it("keeps filters secondary and shows concise timing and read indicators", () => {
    expect(nativeInbox).toContain("hasAttachments");
    expect(nativeInbox).toContain("aria-pressed={hasAttachments}");
    expect(nativeInbox).toContain("readState");
    expect(nativeInbox).toContain("formatTime(message.occurredAt)");
    expect(nativeInbox).toContain("message.deliveryStatus === \"read\"");
  });
});
