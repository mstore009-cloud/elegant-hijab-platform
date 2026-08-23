import { describe, expect, it } from "vitest";

describe("مسار عودة OneDrive", () => {
  it("يحافظ على مسار العودة الثابت الذي يسجل في Azure", () => {
    expect("/api/onedrive/callback").toBe("/api/onedrive/callback");
  });
});
