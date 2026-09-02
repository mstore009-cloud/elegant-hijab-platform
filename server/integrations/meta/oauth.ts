import { ENV } from "../../_core/env";
import { metaPurposes, type MetaAssetType, type MetaAuthMode, type MetaConnectionPurpose, type MetaPurpose } from "./db";
import { getMetaRuntimeSettings } from "./platformSettings";

export const metaScopesByPurpose: Record<MetaPurpose, string[]> = {
  messaging: ["pages_show_list", "pages_messaging", "pages_manage_metadata", "pages_read_engagement", "instagram_basic", "instagram_manage_messages", "whatsapp_business_management", "whatsapp_business_messaging", "business_management"],
  content: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_engagement", "instagram_basic", "instagram_content_publish", "instagram_manage_comments", "instagram_manage_insights"],
  ads_read: ["ads_read", "read_insights", "business_management"],
  leads: ["pages_show_list", "pages_read_engagement", "leads_retrieval"],
  catalog: ["catalog_management", "business_management"],
  measurement: ["ads_read", "business_management"],
};

const configurationByPurpose: Record<MetaPurpose, () => string> = {
  messaging: () => ENV.metaMessagingConfigurationId,
  content: () => ENV.metaContentConfigurationId,
  ads_read: () => ENV.metaAdsReadConfigurationId,
  leads: () => ENV.metaLeadsConfigurationId,
  catalog: () => ENV.metaCatalogConfigurationId,
  measurement: () => ENV.metaMeasurementConfigurationId,
};
export const unifiedMetaScopes = Array.from(new Set(metaPurposes.flatMap(purpose => metaScopesByPurpose[purpose]))).sort();

function graphBase(path: string, graphApiVersion: string) {
  return `https://graph.facebook.com/${graphApiVersion}/${path.replace(/^\//, "")}`;
}

export async function metaConfigurationId(purpose: MetaConnectionPurpose) {
  if (purpose === "unified") return (await getMetaRuntimeSettings()).businessLoginConfigurationId || null;
  return configurationByPurpose[purpose]().trim() || null;
}

export function buildMetaAuthorizationUrl(input: { appId: string; graphApiVersion: string; redirectUri: string; state: string; scopes: string[]; authMode: MetaAuthMode; configurationId?: string | null; rerequest?: boolean }) {
  const url = new URL(`https://www.facebook.com/${input.graphApiVersion}/dialog/oauth`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  if (input.rerequest) url.searchParams.set("auth_type", "rerequest");
  if (input.authMode === "external_business" && input.configurationId) url.searchParams.set("config_id", input.configurationId);
  else url.searchParams.set("scope", Array.from(new Set(input.scopes)).sort().join(","));
  return url.toString();
}

export async function createMetaAuthorizationUrl(input: { state: string; purpose: MetaConnectionPurpose; authMode?: MetaAuthMode; redirectUri?: string; rerequest?: boolean }) {
  const runtime = await getMetaRuntimeSettings();
  const redirectUri = input.redirectUri || ENV.metaRedirectUri;
  if (!runtime.appId || !redirectUri) throw new Error("أكمل إعداد تطبيق Meta ورابط العودة قبل بدء التفويض.");
  const authMode = input.authMode ?? "external_business";
  return buildMetaAuthorizationUrl({
    appId: runtime.appId,
    graphApiVersion: runtime.graphApiVersion,
    redirectUri,
    state: input.state,
    scopes: input.purpose === "unified" ? unifiedMetaScopes : metaScopesByPurpose[input.purpose],
    authMode,
    configurationId: authMode === "external_business" ? await metaConfigurationId(input.purpose) : null,
    rerequest: input.rerequest,
  });
}

async function readMetaJson(response: Response, operation: string) {
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || payload?.error) {
    const code = payload?.error?.code ? ` (${payload.error.code})` : "";
    throw new Error(`فشل ${operation}${code}: ${String(payload?.error?.message || response.statusText || "خطأ Meta").slice(0, 300)}`);
  }
  return payload;
}

export async function exchangeMetaCode(code: string) {
  const runtime = await getMetaRuntimeSettings();
  if (!runtime.appId || !runtime.appSecret || !ENV.metaRedirectUri) throw new Error("إعداد تطبيق Meta غير مكتمل.");
  const url = new URL(graphBase("oauth/access_token", runtime.graphApiVersion));
  url.searchParams.set("client_id", runtime.appId);
  url.searchParams.set("client_secret", runtime.appSecret);
  url.searchParams.set("redirect_uri", ENV.metaRedirectUri);
  url.searchParams.set("code", code);
  const token = await readMetaJson(await fetch(url), "استبدال رمز Meta");
  let accessToken = String(token.access_token || "");
  let expiresIn = Number(token.expires_in || 0);
  if (!accessToken) throw new Error("لم تُرجع Meta رمز وصول صالحاً.");
  try {
    const longUrl = new URL(graphBase("oauth/access_token", runtime.graphApiVersion));
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", runtime.appId);
    longUrl.searchParams.set("client_secret", runtime.appSecret);
    longUrl.searchParams.set("fb_exchange_token", accessToken);
    const longToken = await readMetaJson(await fetch(longUrl), "ترقية رمز Meta");
    if (longToken.access_token) accessToken = String(longToken.access_token);
    if (longToken.expires_in) expiresIn = Number(longToken.expires_in);
  } catch {
    // Some Business Login token types cannot be exchanged; the original token remains valid.
  }
  return { accessToken, expiresIn };
}

export async function inspectMetaToken(accessToken: string) {
  const runtime = await getMetaRuntimeSettings();
  if (!runtime.appId || !runtime.appSecret) throw new Error("إعداد تطبيق Meta غير مكتمل.");
  const url = new URL(graphBase("debug_token", runtime.graphApiVersion));
  url.searchParams.set("input_token", accessToken);
  url.searchParams.set("access_token", `${runtime.appId}|${runtime.appSecret}`);
  const payload = await readMetaJson(await fetch(url), "التحقق من رمز Meta");
  if (!payload?.data?.is_valid) throw new Error("رفضت Meta رمز الوصول أو انتهت صلاحيته.");
  return { userId: payload.data.user_id ? String(payload.data.user_id) : null, scopes: Array.isArray(payload.data.scopes) ? payload.data.scopes.map(String) : [], expiresAt: payload.data.expires_at ? new Date(Number(payload.data.expires_at) * 1000) : null };
}

async function graphGet(pathOrUrl: string, accessToken: string, graphApiVersion: string) {
  const url = pathOrUrl.startsWith("https://") ? new URL(pathOrUrl) : new URL(graphBase(pathOrUrl, graphApiVersion));
  if (url.hostname !== "graph.facebook.com") throw new Error("رفض رابط Graph غير موثوق.");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  return readMetaJson(response, "قراءة أصل Meta");
}

async function graphList(path: string, accessToken: string, fields: string, graphApiVersion: string) {
  const first = new URL(graphBase(path, graphApiVersion));
  first.searchParams.set("fields", fields);
  first.searchParams.set("limit", "100");
  const rows: any[] = [];
  let next: string | null = first.toString();
  for (let page = 0; next && page < 5; page += 1) {
    const payload = await graphGet(next, accessToken, graphApiVersion);
    if (Array.isArray(payload.data)) rows.push(...payload.data);
    next = typeof payload?.paging?.next === "string" ? payload.paging.next : null;
  }
  return rows;
}

export async function getMetaProfile(accessToken: string) {
  const runtime = await getMetaRuntimeSettings();
  const payload = await graphGet("me?fields=id,name", accessToken, runtime.graphApiVersion);
  return { id: payload.id ? String(payload.id) : null, name: payload.name ? String(payload.name) : null };
}

export type DiscoveredMetaAsset = { assetType: MetaAssetType; externalId: string; displayName?: string | null; parentExternalId?: string | null; metadata?: Record<string, unknown> | null; accessToken?: string | null };

export async function discoverMetaAssets(accessToken: string, purpose: MetaConnectionPurpose) {
  const runtime = await getMetaRuntimeSettings();
  const requestedPurposes = purpose === "unified" ? new Set<MetaPurpose>(metaPurposes) : new Set<MetaPurpose>([purpose]);
  const assets: DiscoveredMetaAsset[] = [];
  const failures: string[] = [];
  const attempt = async (label: string, work: () => Promise<void>) => { try { await work(); } catch (error) { failures.push(`${label}: ${error instanceof Error ? error.message : "تعذر الاكتشاف"}`.slice(0, 300)); } };

  let businesses: any[] = [];
  if (["messaging", "catalog", "ads_read", "measurement"].some(item => requestedPurposes.has(item as MetaPurpose))) {
    await attempt("الأعمال", async () => {
      businesses = await graphList("me/businesses", accessToken, "id,name", runtime.graphApiVersion);
      for (const item of businesses) assets.push({ assetType: "business", externalId: String(item.id), displayName: item.name ? String(item.name) : null });
    });
  }

  if (["messaging", "content", "leads"].some(item => requestedPurposes.has(item as MetaPurpose))) {
    await attempt("الصفحات", async () => {
      const pages = await graphList("me/accounts", accessToken, "id,name,access_token,tasks,instagram_business_account{id,name,username}", runtime.graphApiVersion);
      for (const page of pages) {
        const pageToken = page.access_token ? String(page.access_token) : null;
        const tasks = Array.isArray(page.tasks) ? page.tasks.map(String) : [];
        assets.push({ assetType: "page", externalId: String(page.id), displayName: page.name ? String(page.name) : null, accessToken: pageToken, metadata: { tasks } });
        const instagram = page.instagram_business_account;
        if (instagram?.id) assets.push({ assetType: "instagram", externalId: String(instagram.id), displayName: instagram.username ? `@${instagram.username}` : instagram.name ? String(instagram.name) : null, parentExternalId: String(page.id), metadata: { username: instagram.username || null, pageId: String(page.id), pageTasks: tasks }, accessToken: pageToken });
      }
    });
  }

  if (requestedPurposes.has("messaging")) {
    for (const business of businesses) {
      await attempt("WhatsApp", async () => {
        const wabas = await graphList(`${business.id}/owned_whatsapp_business_accounts`, accessToken, "id,name", runtime.graphApiVersion);
        for (const waba of wabas) {
          assets.push({ assetType: "whatsapp_business", externalId: String(waba.id), displayName: waba.name ? String(waba.name) : null, parentExternalId: String(business.id) });
          const phones = await graphList(`${waba.id}/phone_numbers`, accessToken, "id,display_phone_number,verified_name,quality_rating", runtime.graphApiVersion);
          for (const phone of phones) assets.push({ assetType: "whatsapp_phone", externalId: String(phone.id), displayName: phone.verified_name ? String(phone.verified_name) : phone.display_phone_number ? String(phone.display_phone_number) : null, parentExternalId: String(waba.id), metadata: { displayPhoneNumber: phone.display_phone_number || null, qualityRating: phone.quality_rating || null } });
        }
      });
    }
  }

  if (requestedPurposes.has("ads_read") || requestedPurposes.has("measurement")) {
    await attempt("حسابات الإعلانات", async () => {
      const accounts = await graphList("me/adaccounts", accessToken, "id,name,account_status,currency", runtime.graphApiVersion);
      for (const account of accounts) {
        const accountId = String(account.id);
        assets.push({ assetType: "ad_account", externalId: accountId, displayName: account.name ? String(account.name) : null, metadata: { status: account.account_status ?? null, currency: account.currency || null } });
        await attempt("Pixels", async () => {
          const pixels = await graphList(`${accountId}/adspixels`, accessToken, "id,name", runtime.graphApiVersion);
          for (const pixel of pixels) assets.push({ assetType: "pixel", externalId: String(pixel.id), displayName: pixel.name ? String(pixel.name) : null, parentExternalId: accountId });
        });
      }
    });
  }

  if (requestedPurposes.has("catalog")) {
    for (const business of businesses) {
      await attempt("الكتالوج", async () => {
        const catalogs = await graphList(`${business.id}/owned_product_catalogs`, accessToken, "id,name,vertical", runtime.graphApiVersion);
        for (const catalog of catalogs) assets.push({ assetType: "catalog", externalId: String(catalog.id), displayName: catalog.name ? String(catalog.name) : null, parentExternalId: String(business.id), metadata: { vertical: catalog.vertical || null } });
      });
    }
  }
  return { assets, failures };
}
