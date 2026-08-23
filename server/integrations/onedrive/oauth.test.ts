import { describe, expect, it } from "vitest";
import { createOneDriveAuthorizationUrl, createPkcePair, formatOneDriveGraphError, oneDriveAppFolderUrl } from "./oauth";

describe("OAuth الخاص بـ OneDrive", () => {
  it("ينشئ PKCE verifier وchallenge مختلفين وصالحين للاستخدام", () => {
    const pair = createPkcePair();
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.verifier).not.toBe(pair.challenge);
  });

  it("يستخدم رابط العودة المسجل في Azure داخل رابط التفويض", () => {
    const authorizationUrl = new URL(createOneDriveAuthorizationUrl({ state: "test-state", codeChallenge: "test-challenge" }));
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(process.env.MICROSOFT_ONEDRIVE_REDIRECT_URI);
    expect(authorizationUrl.searchParams.get("scope")).toContain("Files.ReadWrite.AppFolder");
    expect(authorizationUrl.pathname).toContain("/consumers/");
  });

  it("يعزل تجربة Catalog في صلاحية Files.Read ولا يطلب App Folder", () => {
    const authorizationUrl = new URL(createOneDriveAuthorizationUrl({
      state: "catalog-state",
      codeChallenge: "catalog-challenge",
      flow: "catalog_read",
    }));
    const scope = authorizationUrl.searchParams.get("scope") ?? "";
    expect(scope).toContain("Files.Read");
    expect(scope).not.toContain("Files.ReadWrite.AppFolder");
  });

  it("يطلب مجلد التطبيق عبر المسار الرسمي الذي ينشئه Graph عند الحاجة", () => {
    expect(oneDriveAppFolderUrl()).toBe("https://graph.microsoft.com/v1.0/me/drive/special/approot");
  });

  it("يعرض حالة Graph وكودها عند فشل الوصول بدل رسالة عامة", () => {
    expect(formatOneDriveGraphError({
      status: 403,
      code: "accessDenied",
      innerCode: "serviceReadOnly",
      requestId: "request-123",
      message: "Access denied",
    })).toBe("[OneDrive Graph 403 / accessDenied / serviceReadOnly / request request-123] Access denied");
  });
});
