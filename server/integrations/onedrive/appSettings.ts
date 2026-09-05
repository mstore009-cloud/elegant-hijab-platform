import { and, eq } from "drizzle-orm";
import { oneDriveAppConfigs } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { decryptOneDriveToken, encryptOneDriveToken } from "./tokenCipher";
import { requireCatalogReauthorization } from "./db";

export const oneDriveAuthorities = ["consumers", "organizations", "common"] as const;
export type OneDriveAuthority = (typeof oneDriveAuthorities)[number];

export type StoreOneDriveAppSettings = {
  id: number;
  clientId: string;
  clientSecret: string;
  authority: OneDriveAuthority;
  redirectUri: string;
};

function requireDb() {
  return getDb().then(db => {
    if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
    return db;
  });
}

export function normalizeOneDrivePublicBaseUrl(value: string) {
  const raw = value.trim().replace(/\/+$/, "");
  if (!raw) throw new Error("أدخل النطاق العام المنشور للمنصة.");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("النطاق العام غير صالح."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("استخدم نطاق HTTPS عاماً فقط، من دون مسار أو معاملات.");
  }
  return url.origin;
}

export function buildOneDriveCallbackUrl(publicBaseUrl: string) {
  return `${normalizeOneDrivePublicBaseUrl(publicBaseUrl)}/api/onedrive/callback`;
}

export function normalizeOneDriveClientId(value: string) {
  const clientId = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) {
    throw new Error("Microsoft Application (client) ID يجب أن يكون GUID صالحاً.");
  }
  return clientId;
}

export async function getOneDriveAppConfig(storeId: number) {
  const db = await requireDb();
  const [row] = await db.select().from(oneDriveAppConfigs).where(eq(oneDriveAppConfigs.storeId, storeId)).limit(1);
  return row ?? null;
}

export async function getMaskedOneDriveAppSettings(storeId: number) {
  const row = await getOneDriveAppConfig(storeId);
  return {
    clientId: row?.clientId ?? "",
    clientSecretConfigured: Boolean(row?.encryptedClientSecret),
    authority: (row?.authority ?? "consumers") as OneDriveAuthority,
    publicBaseUrl: row?.publicBaseUrl ?? "",
    redirectUri: row?.redirectUri ?? "",
    status: row?.status ?? "needs_attention",
    lastTestedAt: row?.lastTestedAt ?? null,
    lastError: row?.lastError ?? "أدخل إعداد Microsoft الخاص بمتجرك قبل بدء التفويض.",
    configured: Boolean(row),
  };
}

export async function saveOneDriveAppSettings(input: {
  storeId: number;
  actorUserId: number;
  clientId: string;
  clientSecret?: string;
  authority: OneDriveAuthority;
  publicBaseUrl: string;
}) {
  const db = await requireDb();
  const current = await getOneDriveAppConfig(input.storeId);
  const clientId = normalizeOneDriveClientId(input.clientId);
  const clientSecret = input.clientSecret?.trim();
  const appIdentityChanged = Boolean(current && (current.clientId !== clientId || current.authority !== input.authority || current.publicBaseUrl !== normalizeOneDrivePublicBaseUrl(input.publicBaseUrl)));
  if (!current?.encryptedClientSecret && !clientSecret) throw new Error("أدخل Client Secret عند الإعداد الأول.");
  const publicBaseUrl = normalizeOneDrivePublicBaseUrl(input.publicBaseUrl);
  const redirectUri = buildOneDriveCallbackUrl(publicBaseUrl);
  const values = {
    storeId: input.storeId,
    clientId,
    encryptedClientSecret: clientSecret ? encryptOneDriveToken(clientSecret) : current!.encryptedClientSecret,
    authority: input.authority,
    publicBaseUrl,
    redirectUri,
    status: "configured" as const,
    lastTestedAt: null,
    lastError: null,
    createdByUserId: current?.createdByUserId ?? input.actorUserId,
    updatedByUserId: input.actorUserId,
  };
  await db.insert(oneDriveAppConfigs).values(values).onDuplicateKeyUpdate({
    set: {
      clientId: values.clientId,
      encryptedClientSecret: values.encryptedClientSecret,
      authority: values.authority,
      publicBaseUrl: values.publicBaseUrl,
      redirectUri: values.redirectUri,
      status: values.status,
      lastTestedAt: values.lastTestedAt,
      lastError: values.lastError,
      updatedByUserId: values.updatedByUserId,
    },
  });
  if (appIdentityChanged) await requireCatalogReauthorization(input.storeId);
  return getMaskedOneDriveAppSettings(input.storeId);
}

export async function getStoreOneDriveAppSettings(storeId: number, expectedConfigId?: number | null): Promise<StoreOneDriveAppSettings> {
  const db = await requireDb();
  const where = expectedConfigId
    ? and(eq(oneDriveAppConfigs.storeId, storeId), eq(oneDriveAppConfigs.id, expectedConfigId))
    : eq(oneDriveAppConfigs.storeId, storeId);
  const [row] = await db.select().from(oneDriveAppConfigs).where(where).limit(1);
  if (!row) throw new Error("أكمل إعداد Microsoft الخاص بهذا المتجر قبل بدء أو تجديد تفويض OneDrive.");
  return {
    id: row.id,
    clientId: row.clientId,
    clientSecret: decryptOneDriveToken(row.encryptedClientSecret),
    authority: row.authority as OneDriveAuthority,
    redirectUri: row.redirectUri,
  };
}

export async function testOneDriveAppSettings(storeId: number, fetcher: typeof fetch = fetch) {
  const settings = await getStoreOneDriveAppSettings(storeId);
  let error: string | null = null;
  try {
    const url = `https://login.microsoftonline.com/${settings.authority}/v2.0/.well-known/openid-configuration`;
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => null) as { authorization_endpoint?: string } | null;
    if (!response.ok || !body?.authorization_endpoint) throw new Error("تعذر الوصول إلى نقطة تفويض Microsoft المحددة.");
  } catch (caught) {
    error = caught instanceof Error ? caught.message.slice(0, 500) : "تعذر اختبار إعداد Microsoft.";
  }
  const db = await requireDb();
  await db.update(oneDriveAppConfigs).set({
    status: error ? "needs_attention" : "verified",
    lastTestedAt: new Date(),
    lastError: error,
  }).where(eq(oneDriveAppConfigs.storeId, storeId));
  if (error) throw new Error(error);
  return getMaskedOneDriveAppSettings(storeId);
}
