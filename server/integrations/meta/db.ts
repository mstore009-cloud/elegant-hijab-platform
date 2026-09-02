import { and, eq, gt, isNull } from "drizzle-orm";
import { metaAssets, metaConnectionCapabilities, metaConnections, metaOAuthStates } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { decryptMetaToken, encryptMetaToken, metaAssetTokenContext, metaConnectionTokenContext, metaSystemUserTokenContext } from "./tokenCipher";

export const metaPurposes = ["messaging", "content", "ads_read", "leads", "catalog", "measurement"] as const;
export type MetaPurpose = (typeof metaPurposes)[number];
export const metaConnectionPurposes = ["unified", ...metaPurposes] as const;
export type MetaConnectionPurpose = (typeof metaConnectionPurposes)[number];
export const metaAuthModes = ["owner_direct", "external_business"] as const;
export type MetaAuthMode = (typeof metaAuthModes)[number];
export type MetaAssetType = "business" | "page" | "instagram" | "whatsapp_business" | "whatsapp_phone" | "ad_account" | "dataset" | "pixel" | "catalog";

const capabilityAssetTypes: Record<MetaPurpose, MetaAssetType[]> = {
  messaging: ["page", "instagram", "whatsapp_phone"],
  content: ["page", "instagram"],
  ads_read: ["ad_account"],
  leads: ["page"],
  catalog: ["catalog"],
  measurement: ["pixel", "dataset"],
};

const capabilityRequiredScopes: Record<MetaPurpose, string[]> = {
  messaging: ["pages_show_list", "pages_messaging", "pages_manage_metadata", "pages_read_engagement", "instagram_basic", "instagram_manage_messages", "whatsapp_business_management", "whatsapp_business_messaging", "business_management"],
  content: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_engagement", "instagram_basic", "instagram_content_publish", "instagram_manage_comments", "instagram_manage_insights"],
  ads_read: ["ads_read", "read_insights", "business_management"],
  leads: ["pages_show_list", "pages_read_engagement", "leads_retrieval"],
  catalog: ["catalog_management", "business_management"],
  measurement: ["ads_read", "business_management"],
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

export async function createMetaOAuthState(input: { state: string; storeId: number; userId: number; purpose: MetaConnectionPurpose; authMode?: MetaAuthMode; requestedScopes: string[]; expiresAt: Date }) {
  const db = await requireDb();
  await db.insert(metaOAuthStates).values({ ...input, authMode: input.authMode ?? "external_business", requestedScopes: input.requestedScopes.join(","), returnTo: "/meta-connections" });
}

export async function consumeMetaOAuthState(state: string) {
  const db = await requireDb();
  const [item] = await db.select().from(metaOAuthStates).where(and(eq(metaOAuthStates.state, state), isNull(metaOAuthStates.usedAt), gt(metaOAuthStates.expiresAt, new Date()))).limit(1);
  if (!item) return null;
  await db.update(metaOAuthStates).set({ usedAt: new Date() }).where(and(eq(metaOAuthStates.id, item.id), isNull(metaOAuthStates.usedAt)));
  return item;
}

export async function upsertMetaConnection(input: { storeId: number; purpose: MetaConnectionPurpose; authMode?: MetaAuthMode; accessToken: string; tokenExpiresAt: Date | null; grantedScopes: string[]; metaUserId: string | null; metaUserName: string | null; configurationId: string | null; connectedByUserId: number }) {
  const db = await requireDb();
  const encryptedAccessToken = encryptMetaToken(input.accessToken, metaConnectionTokenContext(input.storeId, input.purpose));
  const values = {
    storeId: input.storeId,
    purpose: input.purpose,
    authMode: input.authMode ?? "external_business",
    status: "connected" as const,
    encryptedAccessToken,
    tokenExpiresAt: input.tokenExpiresAt,
    grantedScopes: Array.from(new Set(input.grantedScopes)).sort().join(","),
    metaUserId: input.metaUserId,
    metaUserName: input.metaUserName,
    configurationId: input.configurationId,
    connectedByUserId: input.connectedByUserId,
    lastVerifiedAt: new Date(),
    revokedAt: null,
    lastError: null,
  };
  await db.insert(metaConnections).values(values).onDuplicateKeyUpdate({ set: values });
  const [connection] = await db.select().from(metaConnections).where(and(eq(metaConnections.storeId, input.storeId), eq(metaConnections.purpose, input.purpose))).limit(1);
  if (!connection) throw new Error("تعذر حفظ اتصال Meta.");
  return connection;
}

export async function getMetaConnection(storeId: number, purpose: MetaConnectionPurpose) {
  const db = await requireDb();
  const [connection] = await db.select().from(metaConnections).where(and(eq(metaConnections.storeId, storeId), eq(metaConnections.purpose, purpose))).limit(1);
  return connection ?? null;
}

export async function saveMetaSystemUserToken(input: { storeId: number; token: string }) {
  const db = await requireDb();
  const connection = await getMetaConnection(input.storeId, "unified");
  if (!connection) throw new Error("اربط Meta أولاً قبل إضافة اعتماد WhatsApp الدائم.");
  const encryptedSystemUserToken = encryptMetaToken(input.token, metaSystemUserTokenContext(input.storeId));
  const testedAt = new Date();
  await db.update(metaConnections).set({ encryptedSystemUserToken, systemUserTokenStatus: "ready", systemUserTokenLastTestedAt: testedAt }).where(and(eq(metaConnections.id, connection.id), eq(metaConnections.storeId, input.storeId)));
  return { status: "ready" as const, testedAt };
}

export async function getMetaSystemUserToken(storeId: number) {
  const connection = await getMetaConnection(storeId, "unified");
  if (!connection?.encryptedSystemUserToken || connection.systemUserTokenStatus !== "ready") return null;
  return decryptMetaToken(connection.encryptedSystemUserToken, metaSystemUserTokenContext(storeId));
}

export async function revokeMetaSystemUserToken(storeId: number) {
  const db = await requireDb();
  const connection = await getMetaConnection(storeId, "unified");
  if (!connection) return false;
  await db.update(metaConnections).set({ encryptedSystemUserToken: null, systemUserTokenStatus: "revoked", systemUserTokenLastTestedAt: null }).where(and(eq(metaConnections.id, connection.id), eq(metaConnections.storeId, storeId)));
  return true;
}

export async function markMetaSystemUserTokenStatus(storeId: number, status: "ready" | "invalid") {
  const db = await requireDb();
  const connection = await getMetaConnection(storeId, "unified");
  if (!connection) throw new Error("لا يوجد اتصال Meta موحد لهذا المتجر.");
  await db.update(metaConnections).set({ systemUserTokenStatus: status, systemUserTokenLastTestedAt: new Date() }).where(and(eq(metaConnections.id, connection.id), eq(metaConnections.storeId, storeId)));
}

export async function listMetaConnectionOverview(storeId: number) {
  const db = await requireDb();
  const connections = await db.select({ id: metaConnections.id, purpose: metaConnections.purpose, authMode: metaConnections.authMode, status: metaConnections.status, tokenExpiresAt: metaConnections.tokenExpiresAt, grantedScopes: metaConnections.grantedScopes, metaUserId: metaConnections.metaUserId, metaUserName: metaConnections.metaUserName, configurationId: metaConnections.configurationId, systemUserTokenStatus: metaConnections.systemUserTokenStatus, systemUserTokenLastTestedAt: metaConnections.systemUserTokenLastTestedAt, connectedAt: metaConnections.connectedAt, lastVerifiedAt: metaConnections.lastVerifiedAt, revokedAt: metaConnections.revokedAt, lastError: metaConnections.lastError, updatedAt: metaConnections.updatedAt }).from(metaConnections).where(eq(metaConnections.storeId, storeId));
  const assets = await db.select({ id: metaAssets.id, connectionId: metaAssets.connectionId, assetType: metaAssets.assetType, externalId: metaAssets.externalId, displayName: metaAssets.displayName, parentExternalId: metaAssets.parentExternalId, metadataJson: metaAssets.metadataJson, isSelected: metaAssets.isSelected, lastDiscoveredAt: metaAssets.lastDiscoveredAt }).from(metaAssets).where(eq(metaAssets.storeId, storeId));
  const capabilities = await db.select().from(metaConnectionCapabilities).where(eq(metaConnectionCapabilities.storeId, storeId));
  return { connections, assets, capabilities };
}

export async function upsertDiscoveredMetaAssets(input: { storeId: number; connectionId: number; purpose: MetaConnectionPurpose; assets: Array<{ assetType: MetaAssetType; externalId: string; displayName?: string | null; parentExternalId?: string | null; metadata?: Record<string, unknown> | null; accessToken?: string | null }> }) {
  const db = await requireDb();
  for (const asset of input.assets) {
    const encryptedAccessToken = asset.accessToken ? encryptMetaToken(asset.accessToken, metaAssetTokenContext(input.storeId, asset.externalId)) : null;
    const values = {
      storeId: input.storeId,
      connectionId: input.connectionId,
      assetType: asset.assetType,
      externalId: asset.externalId.slice(0, 255),
      displayName: asset.displayName?.slice(0, 255) || null,
      parentExternalId: asset.parentExternalId?.slice(0, 255) || null,
      encryptedAccessToken,
      metadataJson: asset.metadata ? JSON.stringify(asset.metadata).slice(0, 20_000) : null,
      lastDiscoveredAt: new Date(),
    };
    await db.insert(metaAssets).values(values).onDuplicateKeyUpdate({ set: values });
  }
}

/** Copies only matching selections from legacy purpose connections; legacy tokens remain untouched until live unified verification. */
export async function carryLegacyMetaAssetSelections(storeId: number, unifiedConnectionId: number) {
  const db = await requireDb();
  const connections = await db.select({ id: metaConnections.id, purpose: metaConnections.purpose }).from(metaConnections).where(eq(metaConnections.storeId, storeId));
  const legacyConnectionIds = new Set(connections.filter(connection => connection.id !== unifiedConnectionId && connection.purpose !== "unified").map(connection => connection.id));
  if (!legacyConnectionIds.size) return 0;
  const assets = await db.select().from(metaAssets).where(eq(metaAssets.storeId, storeId));
  const legacySelections = new Set(assets.filter(asset => legacyConnectionIds.has(asset.connectionId) && asset.isSelected).map(asset => `${asset.assetType}:${asset.externalId}`));
  const matching = assets.filter(asset => asset.connectionId === unifiedConnectionId && legacySelections.has(`${asset.assetType}:${asset.externalId}`));
  for (const asset of matching) await db.update(metaAssets).set({ isSelected: true }).where(eq(metaAssets.id, asset.id));
  return matching.length;
}

export async function selectMetaAsset(input: { storeId: number; connectionId: number; assetId: number }) {
  return setMetaAssetSelection({ ...input, selected: true });
}

export async function setMetaAssetSelection(input: { storeId: number; connectionId: number; assetId: number; selected: boolean }) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [connection] = await tx.select({ purpose: metaConnections.purpose, grantedScopes: metaConnections.grantedScopes }).from(metaConnections).where(and(eq(metaConnections.id, input.connectionId), eq(metaConnections.storeId, input.storeId))).limit(1);
    const [asset] = await tx.select().from(metaAssets).where(and(eq(metaAssets.id, input.assetId), eq(metaAssets.storeId, input.storeId), eq(metaAssets.connectionId, input.connectionId))).limit(1);
    if (!asset || !connection) throw new Error("الأصل المختار لا ينتمي إلى اتصال Meta في هذا المتجر.");
    await tx.update(metaAssets).set({ isSelected: input.selected }).where(eq(metaAssets.id, asset.id));
    return { ...asset, isSelected: input.selected, connectionPurpose: connection.purpose, grantedScopes: connection.grantedScopes };
  });
}

export async function syncMetaConnectionCapabilities(input: { storeId: number; connectionId: number; grantedScopes: string[] }) {
  const db = await requireDb();
  const selectedAssets = await db.select({ assetType: metaAssets.assetType }).from(metaAssets).where(and(eq(metaAssets.storeId, input.storeId), eq(metaAssets.connectionId, input.connectionId), eq(metaAssets.isSelected, true)));
  const selectedTypes = new Set<MetaAssetType>(selectedAssets.map(asset => asset.assetType));
  const granted = new Set(input.grantedScopes);
  for (const purpose of metaPurposes) {
    const requiredScopes = capabilityRequiredScopes[purpose];
    const missingScopes = requiredScopes.filter(scope => !granted.has(scope));
    const hasAsset = capabilityAssetTypes[purpose].some(type => selectedTypes.has(type));
    const [existing] = await db.select({ enabled: metaConnectionCapabilities.enabled }).from(metaConnectionCapabilities).where(and(eq(metaConnectionCapabilities.connectionId, input.connectionId), eq(metaConnectionCapabilities.purpose, purpose))).limit(1);
    const status: "missing_scope" | "missing_asset" | "disabled" | "ready" = missingScopes.length ? "missing_scope" : hasAsset ? (existing?.enabled === false ? "disabled" : "ready") : "missing_asset";
    const enabled = status === "ready";
    const values: typeof metaConnectionCapabilities.$inferInsert = { storeId: input.storeId, connectionId: input.connectionId, purpose, status, enabled, requiredScopes: requiredScopes.join(","), missingScopes: missingScopes.join(",") || null, lastVerifiedAt: new Date() };
    await db.insert(metaConnectionCapabilities).values(values).onDuplicateKeyUpdate({ set: values });
  }
}

export async function setMetaCapabilityEnabled(input: { storeId: number; connectionId: number; purpose: MetaPurpose; enabled: boolean }) {
  const db = await requireDb();
  const [capability] = await db.select().from(metaConnectionCapabilities).where(and(eq(metaConnectionCapabilities.storeId, input.storeId), eq(metaConnectionCapabilities.connectionId, input.connectionId), eq(metaConnectionCapabilities.purpose, input.purpose))).limit(1);
  if (!capability) throw new Error("لم تُجهز هذه القدرة بعد. حدّث الأصول أولاً.");
  if (input.enabled && capability.missingScopes) throw new Error("لا يمكن تفعيل القدرة قبل إصلاح صلاحيات Meta الناقصة.");
  if (input.enabled && capability.status === "missing_asset") throw new Error("اختر أصلاً مناسباً لهذه القدرة أولاً.");
  await db.update(metaConnectionCapabilities).set({ enabled: input.enabled, status: input.enabled ? "ready" : "disabled", lastVerifiedAt: new Date() }).where(eq(metaConnectionCapabilities.id, capability.id));
  return { ...capability, enabled: input.enabled, status: input.enabled ? "ready" as const : "disabled" as const };
}

export async function disconnectMetaConnection(storeId: number, purpose: MetaConnectionPurpose) {
  const db = await requireDb();
  const [connection] = await db.select().from(metaConnections).where(and(eq(metaConnections.storeId, storeId), eq(metaConnections.purpose, purpose))).limit(1);
  if (!connection) return false;
  await db.transaction(async tx => {
    await tx.update(metaConnections).set({ status: "revoked", encryptedAccessToken: null, encryptedSystemUserToken: null, systemUserTokenStatus: "revoked", systemUserTokenLastTestedAt: null, revokedAt: new Date(), lastError: null }).where(eq(metaConnections.id, connection.id));
    await tx.update(metaAssets).set({ isSelected: false, encryptedAccessToken: null }).where(and(eq(metaAssets.storeId, storeId), eq(metaAssets.connectionId, connection.id)));
    await tx.update(metaConnectionCapabilities).set({ enabled: false, status: "disabled" }).where(and(eq(metaConnectionCapabilities.storeId, storeId), eq(metaConnectionCapabilities.connectionId, connection.id)));
  });
  return true;
}

export async function markMetaConnectionVerified(connectionId: number, error: string | null = null, options?: { fatal?: boolean }) {
  const db = await requireDb();
  const isFatal = Boolean(error) && options?.fatal !== false;
  await db.update(metaConnections).set({ status: isFatal ? "failed" : "connected", lastVerifiedAt: new Date(), lastError: error?.slice(0, 500) || null }).where(eq(metaConnections.id, connectionId));
}
