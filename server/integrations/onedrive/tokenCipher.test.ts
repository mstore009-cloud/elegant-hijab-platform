import { describe, expect, it } from "vitest";
import { decryptOneDriveToken, encryptOneDriveToken } from "./tokenCipher";

describe("تشفير رموز OneDrive", () => {
  it("يعيد الرمز الأصلي بعد التشفير وفك التشفير", () => {
    const original = "sample-access-token";
    expect(decryptOneDriveToken(encryptOneDriveToken(original))).toBe(original);
  });
});
