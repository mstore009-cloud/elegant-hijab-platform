import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Owner-direct WhatsApp platform settings", () => {
  it("does not expose the external Embedded Signup configuration field to the app owner", () => {
    const source = readFileSync(new URL("./MetaPlatformSettings.tsx", import.meta.url), "utf8");
    expect(source).not.toContain('label="WhatsApp Embedded Signup Configuration ID"');
    expect(source).not.toContain("setWhatsappConfigId");
    expect(source).not.toContain("whatsappEmbeddedSignupConfigurationId:");
  });

  it("preserves an internal external-flow configuration when the owner settings form omits it", () => {
    const source = readFileSync(new URL("../../../server/integrations/meta/platformSettings.ts", import.meta.url), "utf8");
    expect(source).toContain("input.whatsappEmbeddedSignupConfigurationId === undefined");
    expect(source).toContain("current?.whatsappEmbeddedSignupConfigurationId ?? null");
  });
});
