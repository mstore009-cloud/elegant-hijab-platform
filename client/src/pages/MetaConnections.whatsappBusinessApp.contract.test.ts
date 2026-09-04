import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("WhatsApp Business App selection guidance", () => {
  it("explains that Business App numbers are selected inside Embedded Signup", () => {
    const source = readFileSync(new URL("./MetaConnections.tsx", import.meta.url), "utf8");
    expect(source).toContain("اختيار رقم WhatsApp Business App");
    expect(source).toContain("الأرقام الموجودة تحت WhatsApp Business App لا تظهر كأصول قابلة للاختيار");
    expect(source).toContain("Connect an existing WhatsApp Business account");
    expect(source).toContain("featureType: config.featureType");
    expect(source).toContain("sessionInfoVersion: config.sessionInfoVersion");
  });

  it("keeps the selected Business App number on the existing completion path", () => {
    const source = readFileSync(new URL("./MetaConnections.tsx", import.meta.url), "utf8");
    expect(source).toContain("completeWhatsApp.mutateAsync(result)");
    expect(source).toContain("completed.coexistence");
    expect(source).toContain("بدأ طلب السجل السابق");
  });
});
