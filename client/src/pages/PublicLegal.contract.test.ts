import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("public Meta legal pages", () => {
  it("registers public privacy, terms, and data deletion routes outside the dashboard", () => {
    const app = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");

    expect(app).toContain('path={"/privacy-policy"} component={PublicLegal}');
    expect(app).toContain('path={"/terms"} component={PublicLegal}');
    expect(app).toContain('path={"/data-deletion"} component={PublicLegal}');
    expect(app).toContain('location === "/privacy-policy"');
    expect(app).toContain('location === "/terms"');
    expect(app).toContain('location === "/data-deletion"');
  });

  it("includes the three Meta-facing page topics and avoids placeholder Facebook links", () => {
    const page = readFileSync(resolve(process.cwd(), "client/src/pages/PublicLegal.tsx"), "utf8");

    expect(page).toContain("سياسة الخصوصية");
    expect(page).toContain("شروط الاستخدام");
    expect(page).toContain("تعليمات حذف البيانات");
    expect(page).not.toContain("facebook.com/");
  });
});
