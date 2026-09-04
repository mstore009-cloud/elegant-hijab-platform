import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./EmployeeBot.tsx", import.meta.url), "utf8");

describe("EmployeeBot permission visibility", () => {
  it("shows the required operational permission in the command list and review dialog", () => {
    expect(source).toContain("requiredPermission");
    expect(source).toContain("الصلاحية المطلوبة");
    expect(source).toContain("permissionMeta");
  });
});
