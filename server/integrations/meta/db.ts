import { and, eq, gt, isNull } from "drizzle-orm";
import { metaAssets, metaConnections, metaOAuthStates } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { encryptMetaToken, metaAssetTokenContext, metaConnectionTokenContext } from "./tokenCipher";

export const metaPurposes = ["messaging", "content", "ads_read", "leads", "catalog", "measurement"] as const;
export type MetaPurpose = (typeof metaPurposes)[number];
export type MetaAssetType = "business" | "page" | "instagram" | "whatsapp_business" | "whatsapp_phone" | "ad_account" | "dataset" | "pixel" | "catalog";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

export async function createMetaOAuthState(input: { state: string; storeId: number; userId: number; purpose: MetaPurpose; requestedScopes: string[]; expiresAt: Date }) {
  const db = await requireDb();
  await db.insert(metaOAuthStates).values({ ...input, requestedScopes: input.requestedScopes.join(","), returnTo: "/meta-connections" });
}

export async function consumeMetaOAuthState(state: string) {
  const db = await requireDb();
  const [item] = await db.select().from(metaOAuthStates).where(and(eq(metaOAuthStates.state, state), isNull(metaOAuthStates.usedAt), gt(metaOAuthStates.expiresAt, new Date()))).limit(1);
  if (!item) return null;
  await db.update(metaOAuthStates).set({ usedAt: new Date() }).where(and(eq(metaOAuthStates.id, item.id), isNull(metaOAuthStates.usedAt)));
  return item;
}

export async function upsertMetaConnection(input: { storeId: number; purpose: MetaPurpose; accessToken: string; tokenExpiresAt: Date | null; grantedScopes: string[]; metaUserId: string | null; metaUserName: string | null; configurationId: string | null; connectedByUserId: number }) {
  const db = await requireDb();
  const encryptedAccessToken = encryptMetaToken(input.accessToken, metaConnectionTokenContext(input.storeId, input.purpose));
  const values = {
    storeId: input.storeId,
    purpose: input.purpose,
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

export async function getMetaConnection(storeId: number, purpose: MetaPurpose) {
  const db = await requireDb();
  const [connection] = await db.select().from(metaConnections).where(and(eq(metaConnections.storeId, storeId), eq(metaConnections.purpose, purpose))).limit(1);
  return connection ?? null;
}

export async function listMetaConnectionOverview(storeId: number) {
  const db = await requireDb();
  const connections = await db.select({ id: metaConnections.id, purpose: metaConnections.purpose, status: metaConnections.status, tokenExpiresAt: metaConnections.tokenExpiresAt, grantedScopes: metaConnections.grantedScopes, metaUserId: metaConnections.metaUserId, metaUserName: metaConnections.metaUserName, configurationId: metaConnections.configurationId, connectedAt: metaConnections.connectedAt, lastVerifiedAt: metaConnections.lastVerifiedAt, revokedAt: metaConnections.revokedAt, lastError: metaConnections.lastError, updatedAt: metaConnections.updatedAt }).from(metaConnections).where(eq(metaConnections.storeId, storeId));
  const assets = await db.select({ id: metaAssets.id, connectionId: metaAssets.connectionId, assetType: metaAssets.assetType, externalId: metaAssets.externalId, displayName: metaAssets.displayName, parentExternalId: metaAssets.parentExternalId, metadataJson: metaAssets.metadataJson, isSelected: metaAssets.isSelected, lastDiscoveredAt: metaAssets.lastDiscoveredAt }).from(metaAssets).where(eq(metaAssets.storeId, storeId));
  return { connections, assets };
}

export async function upsertDiscoveredMetaAssets(input: { storeId: number; connectionId: number; purpose: MetaPurpose; assets: Array<{ assetType: MetaAssetType; externalId: string; displayName?: string | null; parentExternalId?: string | null; metadata?: Record<string, unknown> | null; accessToken?: string | null }> }) {
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

export async function selectMetaAsset(input: { storeId: number; connectionId: number; assetId: number }) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [asset] = await tx.select().from(metaAssets).where(and(eq(metaAssets.id, input.assetId), eq(metaAssets.storeId, input.storeId), eq(metaAssets.connectionId, input.connectionId))).limit(1);
    if (!asset) throw new Error("الأصل المختار لا ينتمي إلى اتصال Meta في هذا المتجر.");
    await tx.update(metaAssets).set({ isSelected: false }).where(and(eq(metaAssets.storeId, input.storeId), eq(metaAssets.connectionId, input.connectionId), eq(metaAssets.assetType, asset.assetType)));
    await tx.update(metaAssets).set({ isSelected: true }).where(eq(metaAssets.id, asset.id));
    return { ...asset, isSelected: true };
  });
}

export async function disconnectMetaConnection(storeId: number, purpose: MetaPurpose) {
  const db = await requireDb();
  const [connection] = await db.select().from(metaConnections).where(and(eq(metaConnections.storeId, storeId), eq(metaConnections.purpose, purpose))).limit(1);
  if (!connection) return false;
  await db.transaction(async tx => {
    await tx.update(metaConnections).set({ status: "revoked", encryptedAccessToken: null, revokedAt: new Date(), lastError: null }).where(eq(metaConnections.id, connection.id));
    await tx.update(metaAssets).set({ isSelected: false, encryptedAccessToken: null }).where(and(eq(metaAssets.storeId, storeId), eq(metaAssets.connectionId, connection.id)));
  });
  return true;
}

export async function markMetaConnectionVerified(connectionId: number, error: string | null = null) {
  const db = await requireDb();
  await db.update(metaConnections).set({ status: error ? "failed" : "connected", lastVerifiedAt: new Date(), lastError: error?.slice(0, 500) || null }).where(eq(metaConnections.id, connectionId));
}
