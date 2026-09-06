import { describe, expect, it } from "vitest";

const describeLiveMicrosoft = process.env.RUN_LIVE_ONEDRIVE_TESTS === "true" ? describe : describe.skip;

describeLiveMicrosoft("معرّف تطبيق OneDrive", () => {
  it("يُقبل من نقطة تفويض Microsoft ولا يشير إلى تطبيق غير موجود", async () => {
    const clientId = process.env.MICROSOFT_ONEDRIVE_CLIENT_ID;
    expect(clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const authorizeUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    authorizeUrl.searchParams.set("client_id", clientId!);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("redirect_uri", "https://3000-i3iwg2cy46vdsfz8fhjdv-0613cf7a.us2.manus.computer/api/onedrive/callback");
    authorizeUrl.searchParams.set("response_mode", "query");
    authorizeUrl.searchParams.set("scope", "openid");

    const response = await fetch(authorizeUrl, { redirect: "manual" });
    const responseBody = await response.text();
    expect(response.status).toBeLessThan(500);
    expect(responseBody).not.toContain("AADSTS700016");
    expect(responseBody.toLowerCase()).not.toContain("application with identifier");
  }, 15_000);

  it("يقبل Microsoft Client Secret مع رفض رمز تفويض تجريبي فقط", async () => {
    const clientId = process.env.MICROSOFT_ONEDRIVE_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_ONEDRIVE_CLIENT_SECRET;
    const redirectUri = process.env.MICROSOFT_ONEDRIVE_REDIRECT_URI;
    expect(clientSecret).toBeTruthy();

    const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId!,
        client_secret: clientSecret!,
        grant_type: "authorization_code",
        code: "intentionally-invalid-test-code",
        redirect_uri: redirectUri!,
      }),
    });
    const responseBody = await response.text();
    expect(response.status).toBeLessThan(500);
    expect(responseBody).not.toContain("AADSTS7000215");
    expect(responseBody.toLowerCase()).not.toContain("invalid client secret");
  }, 15_000);
});
