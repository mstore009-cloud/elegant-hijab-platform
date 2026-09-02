import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { metaPlatformSettings } from "../../../drizzle/schema";
import { ENV } from "../../_core/env";
import { getDb } from "../../db";
import { decryptMetaToken, encryptMetaToken, metaPlatformSecretContext } from "./tokenCipher";

export const allowedMetaGraphVersions = ["v26.0", "v25.0", "v24.0"] as const;
export type MetaGraphVersion = (typeof allowedMetaGraphVersions)[number];

export type MetaRuntimeSettings = {
  appId: string;
  appSecret: string;
  businessLoginConfigurationId: string;
  whatsappEmbeddedSignupConfigurationId: string;
  webhookVerifyToken: string;
  graphApiVersion: string;
  source: "database" | "environment" | "none";
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

export async function getMetaPlatformSettingsRow() {
  const db = await requireDb();
  const [row] = await db.select().from(metaPlatformSettings).where(eq(metaPlatformSettings.id, 1)).limit(1);
  return row ?? null;
}

function decryptOptional(cipherText: string | null, field: "app-secret" | "webhook-verify-token") {
  return cipherText ? decryptMetaToken(cipherText, metaPlatformSecretContext(field)) : "";
}

export async function getMetaRuntimeSettings(): Promise<MetaRuntimeSettings> {
  let row: Awaited<ReturnType<typeof getMetaPlatformSettingsRow>> | null = null;
  try {
    row = await getMetaPlatformSettingsRow();
  } catch {
    // Environment fallback keeps the existing deployment operational during migration.
  }
  if (row?.appId && row.encryptedAppSecret) {
    return {
      appId: row.appId,
      appSecret: decryptOptional(row.encryptedAppSecret, "app-secret"),
      businessLoginConfigurationId: row.businessLoginConfigurationId ?? "",
      whatsappEmbeddedSignupConfigurationId: row.whatsappEmbeddedSignupConfigurationId ?? "",
      webhookVerifyToken: decryptOptional(row.encryptedWebhookVerifyToken, "webhook-verify-token"),
      graphApiVersion: row.graphApiVersion,
      source: "database",
    };
  }
  const appId = ENV.metaAppId.trim();
  const appSecret = ENV.metaAppSecret.trim();
  return {
    appId,
    appSecret,
    businessLoginConfigurationId: ENV.metaMessagingConfigurationId.trim(),
    whatsappEmbeddedSignupConfigurationId: "",
    webhookVerifyToken: ENV.metaWebhookVerifyToken.trim(),
    graphApiVersion: ENV.metaGraphApiVersion,
    source: appId && appSecret ? "environment" : "none",
  };
}

export async function getMaskedMetaPlatformSettings() {
  const row = await getMetaPlatformSettingsRow();
  const runtime = await getMetaRuntimeSettings();
  return {
    appId: row?.appId ?? runtime.appId,
    appSecretConfigured: Boolean(row?.encryptedAppSecret || runtime.appSecret),
    businessLoginConfigurationId: row?.businessLoginConfigurationId ?? runtime.businessLoginConfigurationId,
    whatsappEmbeddedSignupConfigurationId: row?.whatsappEmbeddedSignupConfigurationId ?? runtime.whatsappEmbeddedSignupConfigurationId,
    webhookVerifyTokenConfigured: Boolean(row?.encryptedWebhookVerifyToken || runtime.webhookVerifyToken),
    graphApiVersion: row?.graphApiVersion ?? runtime.graphApiVersion,
    status: row?.status ?? (runtime.appId && runtime.appSecret ? "ready" : "incomplete"),
    source: row?.appId && row.encryptedAppSecret ? "database" : runtime.source,
    lastTestedAt: row?.lastTestedAt ?? null,
    lastError: row?.lastError ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function saveMetaPlatformSettings(input: {
  appId: string;
  appSecret?: string;
  businessLoginConfigurationId: string;
  whatsappEmbeddedSignupConfigurationId?: string;
  graphApiVersion: MetaGraphVersion;
  actorUserId: number;
}) {
  const db = await requireDb();
  const current = await getMetaPlatformSettingsRow();
  const appId = input.appId.trim();
  const businessLoginConfigurationId = input.businessLoginConfigurationId.trim();
  const appSecret = input.appSecret?.trim();
  if (!/^\d{5,80}$/.test(appId)) throw new Error("معرّف تطبيق Meta يجب أن يتكون من أرقام فقط.");
  if (!businessLoginConfigurationId) throw new Error("أدخل Business Login Configuration ID الموحد.");
  if (!current?.encryptedAppSecret && !appSecret) throw new Error("أدخل App Secret عند الإعداد الأول.");
  const verifyTokenPlain = current?.encryptedWebhookVerifyToken ? null : randomBytes(32).toString("base64url");
  const values = {
    id: 1,
    appId,
    encryptedAppSecret: appSecret ? encryptMetaToken(appSecret, metaPlatformSecretContext("app-secret")) : current!.encryptedAppSecret,
    businessLoginConfigurationId,
    whatsappEmbeddedSignupConfigurationId: input.whatsappEmbeddedSignupConfigurationId?.trim() || null,
    encryptedWebhookVerifyToken: verifyTokenPlain
      ? encryptMetaToken(verifyTokenPlain, metaPlatformSecretContext("webhook-verify-token"))
      : current?.encryptedWebhookVerifyToken ?? null,
    graphApiVersion: input.graphApiVersion,
    status: "ready" as const,
    lastError: null,
    updatedByUserId: input.actorUserId,
  };
  await db.insert(metaPlatformSettings).values(values).onDuplicateKeyUpdate({ set: values });
  return { settings: await getMaskedMetaPlatformSettings(), generatedWebhookVerifyToken: verifyTokenPlain };
}

export async function rotateMetaWebhookVerifyToken(actorUserId: number) {
  const db = await requireDb();
  const plainText = randomBytes(32).toString("base64url");
  await db.insert(metaPlatformSettings).values({
    id: 1,
    encryptedWebhookVerifyToken: encryptMetaToken(plainText, metaPlatformSecretContext("webhook-verify-token")),
    updatedByUserId: actorUserId,
  }).onDuplicateKeyUpdate({ set: {
    encryptedWebhookVerifyToken: encryptMetaToken(plainText, metaPlatformSecretContext("webhook-verify-token")),
    status: "ready",
    lastError: null,
    updatedByUserId: actorUserId,
  } });
  return plainText;
}

export async function testMetaPlatformSettings(fetcher: typeof fetch = fetch) {
  const db = await requireDb();
  const runtime = await getMetaRuntimeSettings();
  if (!runtime.appId || !runtime.appSecret || !runtime.businessLoginConfigurationId) throw new Error("أكمل إعداد تطبيق Meta الموحد أولاً.");
  const url = new URL(`https://graph.facebook.com/${runtime.graphApiVersion}/${runtime.appId}`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", `${runtime.appId}|${runtime.appSecret}`);
  let error: string | null = null;
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok || payload?.error) throw new Error(String(payload?.error?.message || response.statusText || "رفضت Meta الإعداد"));
  } catch (caught) {
    error = caught instanceof Error ? caught.message.slice(0, 500) : "تعذر اختبار إعداد Meta.";
  }
  await db.update(metaPlatformSettings).set({ status: error ? "needs_attention" : "verified", lastTestedAt: new Date(), lastError: error }).where(eq(metaPlatformSettings.id, 1));
  if (error) throw new Error(error);
  return getMaskedMetaPlatformSettings();
}
