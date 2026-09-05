import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Inbox rich Meta message context", () => {
  it("renders normalized context without exposing raw provider payloads", () => {
    const source = readFileSync(new URL("./Inbox.tsx", import.meta.url), "utf8");
    expect(source).toContain("message.metadata");
    expect(source).toContain("رسالة صوتية");
    expect(source).toContain("صورة مرفقة");
    expect(source).not.toContain("نوع الرسالة:");
    expect(source).toContain("رد على رسالة سابقة");
    expect(source).toContain("رد على قصة");
    expect(source).toContain("منشن:");
    expect(source).toContain("unsupportedReason");
    expect(source).not.toContain("access_token");
  });
});
