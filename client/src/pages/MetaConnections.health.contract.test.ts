import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Meta connection health UI", () => {
  it("places Instagram dashboard guidance and page-binding verification inside the Webhook and health tab", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/MetaConnections.tsx"), "utf8");
    const healthStart = source.indexOf('<TabsContent value="health"');
    const securityStart = source.indexOf('<TabsContent value="security"');
    const health = source.slice(healthStart, securityStart);

    expect(healthStart).toBeGreaterThan(-1);
    expect(health).toContain("استقبال Instagram");
    expect(health).toContain("فحص ربط الصفحة");
    expect(health).toContain("repairInstagram.mutate()");
    expect(health).toContain("حقول Instagram");
    expect(health).toContain("تُضبط في Meta");
    expect(health).toContain("instagram_business_manage_messages");
  });
});
