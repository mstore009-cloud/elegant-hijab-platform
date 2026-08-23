import { createHash, randomBytes } from "crypto";
import { ENV } from "../../_core/env";

const scopes = ["openid", "profile", "offline_access", "User.Read", "Files.ReadWrite.AppFolder"];

function toBase64Url(value: Buffer) {
  return value.toString("base64url");
}

export function createPkcePair() {
  const verifier = toBase64Url(randomBytes(48));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOneDriveAuthorizationUrl(input: { state: string; codeChallenge: string }) {
  if (!ENV.oneDriveClientId || !ENV.oneDriveRedirectUri) {
    throw new Error("إعداد OAuth لـ OneDrive غير مكتمل.");
  }
  const url = new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
  url.searchParams.set("client_id", ENV.oneDriveClientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", ENV.oneDriveRedirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeOneDriveCode(input: { code: string; codeVerifier: string }) {
  if (!ENV.oneDriveClientSecret) {
    throw new Error("سر تطبيق OneDrive غير مهيأ.");
  }
  const body = new URLSearchParams({
    client_id: ENV.oneDriveClientId,
    client_secret: ENV.oneDriveClientSecret,
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: ENV.oneDriveRedirectUri,
    code_verifier: input.codeVerifier,
  });
  const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token || !payload.refresh_token || !payload.expires_in) {
    throw new Error(payload.error_description ?? payload.error ?? "تعذر استبدال رمز OneDrive بالتفويض.");
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
    scope: payload.scope ?? "",
  };
}

export async function getOneDriveAppFolder(accessToken: string) {
  const bootstrapUrl = "https://graph.microsoft.com/v1.0/me/drive/special/approot/children/.ehp-connection.json:/content";
  const bootstrap = await fetch(bootstrapUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ managedBy: "ElegantHijabPlatform", purpose: "OneDrive App Folder initialization" }),
  });
  if (!bootstrap.ok) {
    const bootstrapPayload = await bootstrap.json() as { error?: { message?: string } };
    throw new Error(bootstrapPayload.error?.message ?? "تعذر تهيئة مجلد تطبيق OneDrive.");
  }

  const response = await fetch("https://graph.microsoft.com/v1.0/me/drive/special/approot", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json() as { id?: string; webUrl?: string; error?: { message?: string } };
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message ?? "تعذر الوصول إلى مجلد تطبيق OneDrive.");
  }
  return { id: payload.id, webUrl: payload.webUrl ?? null };
}

export function oneDriveAppFolderBootstrapUrl() {
  return "https://graph.microsoft.com/v1.0/me/drive/special/approot/children/.ehp-connection.json:/content";
}
