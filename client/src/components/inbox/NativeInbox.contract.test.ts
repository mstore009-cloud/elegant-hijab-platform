import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nativeInbox = readFileSync(new URL("./NativeInbox.tsx", import.meta.url), "utf8");
const mediaViewer = readFileSync(new URL("./ThreadMedia.tsx", import.meta.url), "utf8");

describe("Native Inbox conversation experience", () => {
  it("keeps the daily workspace focused on conversations and moves operational tools to an optional panel", () => {
    expect(nativeInbox).toContain("تفاصيل المحادثة");
    expect(nativeInbox).toContain("detailsOpen");
    expect(nativeInbox).toContain("ConversationDetails");
    expect(nativeInbox).toContain("محادثات");
    expect(nativeInbox).not.toContain("سجل التشغيل");
    expect(nativeInbox).not.toContain("مصادر المعرفة");
    expect(nativeInbox).not.toContain("نوع الرسالة");
  });

  it("renders images, video, audio, and documents as natural media rather than technical attachment labels", () => {
    expect(mediaViewer).toContain("<img src={item.url}");
    expect(mediaViewer).toContain("<video src={item.url}");
    expect(mediaViewer).toContain("<audio src={item.url}");
    expect(mediaViewer).toContain("<Dialog open={Boolean(viewer)}");
    expect(mediaViewer).toContain("فتح الصورة بالحجم الكامل");
    expect(mediaViewer).not.toContain("مرفق");
    expect(mediaViewer).not.toContain("بانتظار تجهيز");
  });

  it("keeps filters secondary while retaining search, channels, unread state, and media filtering", () => {
    expect(nativeInbox).toContain("filtersOpen");
    expect(nativeInbox).toContain("aria-label=\"الفلاتر\"");
    expect(nativeInbox).toContain("readState");
    expect(nativeInbox).toContain("hasAttachments");
  });

  it("opens the selected thread on mobile and provides a direct return to the conversation list", () => {
    expect(nativeInbox).toContain("showThreadMobile");
    expect(nativeInbox).toContain("setShowThreadMobile(true)");
    expect(nativeInbox).toContain("setShowThreadMobile(false)");
    expect(nativeInbox).toContain("aria-label=\"العودة إلى المحادثات\"");
  });
});
