import { createHash, randomBytes } from "crypto";
import type { OneDriveAuthority } from "./appSettings";

export type OneDriveOAuthFlow = "app_folder" | "catalog_read";
export type OneDriveOAuthApplication = {
  clientId: string;
  clientSecret: string;
  authority: OneDriveAuthority;
  redirectUri: string;
};

const scopesByFlow: Record<OneDriveOAuthFlow, string[]> = {
  app_folder: ["openid", "profile", "offline_access", "User.Read", "Files.ReadWrite.AppFolder"],
  catalog_read: ["openid", "profile", "offline_access", "User.Read", "Files.Read"],
};

function toBase64Url(value: Buffer) {
  return value.toString("base64url");
}

export function createPkcePair() {
  const verifier = toBase64Url(randomBytes(48));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function authorityBase(authority: OneDriveAuthority) {
  return `https://login.microsoftonline.com/${authority}/oauth2/v2.0`;
}

export function createOneDriveAuthorizationUrl(input: { state: string; codeChallenge: string; application: OneDriveOAuthApplication; flow?: OneDriveOAuthFlow }) {
  const url = new URL(`${authorityBase(input.application.authority)}/authorize`);
  url.searchParams.set("client_id", input.application.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.application.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", scopesByFlow[input.flow ?? "app_folder"].join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeOneDriveCode(input: { code: string; codeVerifier: string; application: OneDriveOAuthApplication }) {
  const body = new URLSearchParams({
    client_id: input.application.clientId,
    client_secret: input.application.clientSecret,
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.application.redirectUri,
    code_verifier: input.codeVerifier,
  });
  const response = await fetch(`${authorityBase(input.application.authority)}/token`, {
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

export async function refreshOneDriveToken(input: { refreshToken: string; application: OneDriveOAuthApplication }) {
  const body = new URLSearchParams({
    client_id: input.application.clientId,
    client_secret: input.application.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
  const response = await fetch(`${authorityBase(input.application.authority)}/token`, {
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
  if (!response.ok || !payload.access_token || !payload.expires_in) {
    throw new Error(payload.error_description ?? payload.error ?? "تعذر تجديد تفويض قراءة OneDrive.");
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? input.refreshToken,
    expiresIn: payload.expires_in,
    scope: payload.scope ?? "",
  };
}

export async function getOneDriveAppFolder(accessToken: string) {
  const response = await fetch(oneDriveAppFolderUrl(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json() as {
    id?: string;
    webUrl?: string;
    error?: {
      code?: string;
      message?: string;
      innerError?: { code?: string; requestId?: string; [key: string]: unknown };
    };
  };
  if (!response.ok || !payload.id) {
    throw new Error(formatOneDriveGraphError({
      status: response.status,
      code: payload.error?.code,
      message: payload.error?.message,
      innerCode: payload.error?.innerError?.code,
      requestId: payload.error?.innerError?.requestId,
    }));
  }
  return { id: payload.id, webUrl: payload.webUrl ?? null };
}

export function oneDriveAppFolderUrl() {
  return "https://graph.microsoft.com/v1.0/me/drive/special/approot";
}

export function formatOneDriveGraphError(input: {
  status: number;
  code?: string;
  message?: string;
  innerCode?: string;
  requestId?: string;
}) {
  const code = input.code ? ` / ${input.code}` : "";
  const innerCode = input.innerCode ? ` / ${input.innerCode}` : "";
  const requestId = input.requestId ? ` / request ${input.requestId}` : "";
  const message = input.message ?? "تعذر الوصول إلى مجلد تطبيق OneDrive.";
  return `[OneDrive Graph ${input.status}${code}${innerCode}${requestId}] ${message}`;
}
