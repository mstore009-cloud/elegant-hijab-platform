import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { metaOnboardingTemplates, metaPlatformSettings } from "../../../drizzle/schema";
import { ENV } from "../../_core/env";
import { getDb } from "../../db";
import { decryptMetaToken, encryptMetaToken, metaPlatformSecretContext } from "./tokenCipher";

export const allowedMetaGraphVersions = ["v26.0", "v25.0", "v24.0"] as const;
export type MetaGraphVersion = (typeof allowedMetaGraphVersions)[number];
export const defaultMetaCapabilities = ["messaging", "content", "ads_read", "leads", "catalog", "measurement"] as const;
export type MetaTemplateCapability = (typeof defaultMetaCapabilities)[number];

export type MetaRuntimeSettings = {
  appId: string;
  appSecret: string;
  businessLoginConfigurationId: string;
  whatsappEmbeddedSignupConfigurationId: string;
  webhookVerifyToken: string;
  graphApiVersion: string;
  publicBaseUrl: string;
  activeTemplateVersion: number;
  source: "database" | "environment" | "none";
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

function environmentPublicBaseUrl() {
  try { return new URL(ENV.metaRedirectUri).origin; } catch { return ""; }
}

export function normalizeMetaPublicBaseUrl(value: string) {
  const raw = value.trim().replace(/\/+$/, "");
  if (!raw) throw new Error("أدخل النطاق العام للمنصة.");
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("النطاق العام غير صالح."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") throw new Error("استخدم نطاق HTTPS عاماً فقط من دون مسار أو معاملات.");
  return parsed.origin;
}

export function buildMetaPlatformUrls(publicBaseUrl: string) {
  const base = normalizeMetaPublicBaseUrl(publicBaseUrl);
  return {
    oauthCallbackUrl: `${base}/api/meta/oauth/callback`,
    webhookCallbackUrl: `${base}/api/webhooks/meta`,
  };
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
  try { row = await getMetaPlatformSettingsRow(); } catch { /* environment fallback during migration */ }
  if (row?.appId && row.encryptedAppSecret) {
    return {
      appId: row.appId,
      appSecret: decryptOptional(row.encryptedAppSecret, "app-secret"),
      businessLoginConfigurationId: row.businessLoginConfigurationId ?? "",
      whatsappEmbeddedSignupConfigurationId: row.whatsappEmbeddedSignupConfigurationId ?? "",
      webhookVerifyToken: decryptOptional(row.encryptedWebhookVerifyToken, "webhook-verify-token"),
      graphApiVersion: row.graphApiVersion,
      publicBaseUrl: row.publicBaseUrl || environmentPublicBaseUrl(),
      activeTemplateVersion: row.activeTemplateVersion || 1,
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
    publicBaseUrl: environmentPublicBaseUrl(),
    activeTemplateVersion: 1,
    source: appId && appSecret ? "environment" : "none",
  };
}

function parseCapabilities(value: string | null | undefined): MetaTemplateCapability[] {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) return [...defaultMetaCapabilities];
    const allowed = parsed.filter((item): item is MetaTemplateCapability => defaultMetaCapabilities.includes(item));
    return allowed.length ? Array.from(new Set(allowed)) : [...defaultMetaCapabilities];
  } catch { return [...defaultMetaCapabilities]; }
}

export async function getActiveMetaOnboardingTemplate() {
  const db = await requireDb();
  const runtime = await getMetaRuntimeSettings();
  const [template] = await db.select().from(metaOnboardingTemplates).where(and(eq(metaOnboardingTemplates.version, runtime.activeTemplateVersion), eq(metaOnboardingTemplates.status, "active"))).limit(1);
  if (template) return { ...template, defaultCapabilities: parseCapabilities(template.defaultCapabilitiesJson) };
  return {
    id: null,
    version: runtime.activeTemplateVersion,
    name: `قالب Meta v${runtime.activeTemplateVersion}`,
    status: "active" as const,
    businessLoginConfigurationId: runtime.businessLoginConfigurationId || null,
    whatsappEmbeddedSignupConfigurationId: runtime.whatsappEmbeddedSignupConfigurationId || null,
    defaultCapabilities: [...defaultMetaCapabilities],
    readinessJson: null,
    activatedAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

export async function getMaskedMetaPlatformSettings() {
  const row = await getMetaPlatformSettingsRow();
  const runtime = await getMetaRuntimeSettings();
  const activeTemplate = await getActiveMetaOnboardingTemplate();
  const publicBaseUrl = row?.publicBaseUrl || runtime.publicBaseUrl;
  const urls = publicBaseUrl ? buildMetaPlatformUrls(publicBaseUrl) : { oauthCallbackUrl: "", webhookCallbackUrl: "" };
  return {
    appId: row?.appId ?? runtime.appId,
    appSecretConfigured: Boolean(row?.encryptedAppSecret || runtime.appSecret),
    businessLoginConfigurationId: activeTemplate.businessLoginConfigurationId ?? runtime.businessLoginConfigurationId,
    whatsappEmbeddedSignupConfigurationId: activeTemplate.whatsappEmbeddedSignupConfigurationId ?? runtime.whatsappEmbeddedSignupConfigurationId,
    webhookVerifyTokenConfigured: Boolean(row?.encryptedWebhookVerifyToken || runtime.webhookVerifyToken),
    graphApiVersion: row?.graphApiVersion ?? runtime.graphApiVersion,
    publicBaseUrl,
    oauthCallbackUrl: urls.oauthCallbackUrl,
    webhookCallbackUrl: urls.webhookCallbackUrl,
    activeTemplateVersion: activeTemplate.version,
    activeTemplateName: activeTemplate.name,
    activeTemplateStatus: activeTemplate.status,
    defaultCapabilities: activeTemplate.defaultCapabilities,
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
  publicBaseUrl: string;
  defaultCapabilities?: MetaTemplateCapability[];
  actorUserId: number;
}) {
  const db = await requireDb();
  const current = await getMetaPlatformSettingsRow();
  const appId = input.appId.trim();
  const appSecret = input.appSecret?.trim();
  const businessLoginConfigurationId = input.businessLoginConfigurationId.trim();
  const whatsappEmbeddedSignupConfigurationId = input.whatsappEmbeddedSignupConfigurationId?.trim() || null;
  const publicBaseUrl = normalizeMetaPublicBaseUrl(input.publicBaseUrl);
  if (!/^\d{5,80}$/.test(appId)) throw new Error("معرّف تطبيق Meta يجب أن يتكون من أرقام فقط.");
  if (!current?.encryptedAppSecret && !appSecret) throw new Error("أدخل App Secret عند الإعداد الأول.");
  const [latestTemplate] = await db.select({ version: metaOnboardingTemplates.version }).from(metaOnboardingTemplates).orderBy(desc(metaOnboardingTemplates.version)).limit(1);
  const nextVersion = latestTemplate ? latestTemplate.version + 1 : 1;
  const verifyTokenPlain = current?.encryptedWebhookVerifyToken ? null : randomBytes(32).toString("base64url");
  const capabilities = input.defaultCapabilities?.filter(item => defaultMetaCapabilities.includes(item)) || [...defaultMetaCapabilities];
  await db.transaction(async tx => {
    await tx.update(metaOnboardingTemplates).set({ status: "retired" }).where(eq(metaOnboardingTemplates.status, "active"));
    await tx.insert(metaOnboardingTemplates).values({
      version: nextVersion,
      name: `قالب Meta v${nextVersion}`,
      status: "active",
      businessLoginConfigurationId: businessLoginConfigurationId || null,
      whatsappEmbeddedSignupConfigurationId,
      defaultCapabilitiesJson: JSON.stringify(Array.from(new Set(capabilities))),
      readinessJson: JSON.stringify({ app: true, oauth: Boolean(businessLoginConfigurationId), whatsapp: Boolean(whatsappEmbeddedSignupConfigurationId), webhook: true }),
      createdByUserId: input.actorUserId,
      activatedAt: new Date(),
    });
    const values = {
      id: 1,
      appId,
      encryptedAppSecret: appSecret ? encryptMetaToken(appSecret, metaPlatformSecretContext("app-secret")) : current!.encryptedAppSecret,
      businessLoginConfigurationId,
      whatsappEmbeddedSignupConfigurationId,
      encryptedWebhookVerifyToken: verifyTokenPlain ? encryptMetaToken(verifyTokenPlain, metaPlatformSecretContext("webhook-verify-token")) : current?.encryptedWebhookVerifyToken ?? null,
      publicBaseUrl,
      activeTemplateVersion: nextVersion,
      graphApiVersion: input.graphApiVersion,
      status: "ready" as const,
      lastError: null,
      updatedByUserId: input.actorUserId,
    };
    await tx.insert(metaPlatformSettings).values(values).onDuplicateKeyUpdate({ set: values });
  });
  return { settings: await getMaskedMetaPlatformSettings(), generatedWebhookVerifyToken: verifyTokenPlain };
}

export async function rotateMetaWebhookVerifyToken(actorUserId: number) {
  const db = await requireDb();
  const plainText = randomBytes(32).toString("base64url");
  const cipherText = encryptMetaToken(plainText, metaPlatformSecretContext("webhook-verify-token"));
  await db.insert(metaPlatformSettings).values({ id: 1, encryptedWebhookVerifyToken: cipherText, updatedByUserId: actorUserId }).onDuplicateKeyUpdate({ set: { encryptedWebhookVerifyToken: cipherText, status: "ready", lastError: null, updatedByUserId: actorUserId } });
  return plainText;
}

export async function testMetaPlatformSettings(fetcher: typeof fetch = fetch) {
  const db = await requireDb();
  const runtime = await getMetaRuntimeSettings();
  if (!runtime.appId || !runtime.appSecret) throw new Error("أكمل App ID وApp Secret لتطبيق Meta أولاً.");
  if (!runtime.publicBaseUrl) throw new Error("أكمل النطاق العام للمنصة أولاً.");
  const url = new URL(`https://graph.facebook.com/${runtime.graphApiVersion}/${runtime.appId}`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", `${runtime.appId}|${runtime.appSecret}`);
  let error: string | null = null;
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok || payload?.error) throw new Error(String(payload?.error?.message || response.statusText || "رفضت Meta الإعداد"));
  } catch (caught) { error = caught instanceof Error ? caught.message.slice(0, 500) : "تعذر اختبار إعداد Meta."; }
  await db.update(metaPlatformSettings).set({ status: error ? "needs_attention" : "verified", lastTestedAt: new Date(), lastError: error }).where(eq(metaPlatformSettings.id, 1));
  if (error) throw new Error(error);
  return getMaskedMetaPlatformSettings();
}

export async function recordMetaPlatformWebhookReadiness(results: Array<{ object: string; ready: boolean; error: string | null }>) {
  const db = await requireDb();
  const failures = results.filter(item => !item.ready);
  const lastError = failures.length ? failures.map(item => `${item.object}: ${item.error || "غير جاهز"}`).join(" | ").slice(0, 500) : null;
  await db.update(metaPlatformSettings).set({ status: failures.length ? "needs_attention" : "verified", lastTestedAt: new Date(), lastError }).where(eq(metaPlatformSettings.id, 1));
  return { ready: failures.length === 0, results, lastError };
}
