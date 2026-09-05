import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Owner-direct WhatsApp selection guidance", () => {
  it("keeps owner WhatsApp inside the unified Meta connection", () => {
    const source = readFileSync(new URL("./MetaConnections.tsx", import.meta.url), "utf8");
    expect(source).toContain("WhatsApp عبر الاتصال الموحد");
    expect(source).toContain("لا يستخدم هذا المتجر Embedded Signup أو Configuration ID");
    expect(source).toContain("System User Token");
    expect(source).toContain("whatsapp_business");
  });

  it("removes the owner-facing Embedded Signup launcher", () => {
    const source = readFileSync(new URL("./MetaConnections.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("runWhatsAppEmbeddedSignup");
    expect(source).not.toContain("beginWhatsAppEmbeddedSignup.useMutation");
    expect(source).not.toContain("اختيار رقم WhatsApp Business App");
  });
});
