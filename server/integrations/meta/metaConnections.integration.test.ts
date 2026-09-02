import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { channelAccounts, metaAssets, metaConnectionCapabilities, metaConnections, metaOAuthStates, stores, users } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { configureChannelAccount } from "../../channels/db";
import { carryLegacyMetaAssetSelections, consumeMetaOAuthState, createMetaOAuthState, disconnectMetaConnection, getMetaSystemUserToken, listMetaConnectionOverview, markMetaConnectionVerified, revokeMetaSystemUserToken, saveMetaSystemUserToken, selectMetaAsset, setMetaAssetSelection, setMetaCapabilityEnabled, syncMetaConnectionCapabilities, upsertDiscoveredMetaAssets, upsertMetaConnection } from "./db";
import { buildMetaAuthorizationUrl, metaScopesByPurpose, unifiedMetaScopes } from "./oauth";
import { decryptMetaToken, encryptMetaToken, metaConnectionTokenContext, metaPlatformSecretContext } from "./tokenCipher";
import { loadMetaCredential } from "../../channels/metaOutbound";

const cleanupStoreIds: number[] = [];

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  for (const storeId of cleanupStoreIds.splice(0)) {
    await db.delete(channelAccounts).where(eq(channelAccounts.storeId, storeId));
    await db.delete(metaConnectionCapabilities).where(eq(metaConnectionCapabilities.storeId, storeId));
    await db.delete(metaAssets).where(eq(metaAssets.storeId, storeId));
    await db.delete(metaOAuthStates).where(eq(metaOAuthStates.storeId, storeId));
    await db.delete(metaConnections).where(eq(metaConnections.storeId, storeId));
    await db.delete(stores).where(eq(stores.id, storeId));
  }
});

async function setup() {
  const db = await getDb();
  const [owner] = db ? await db.select({ id: users.id }).from(users).limit(1) : [];
  if (!db || !owner) throw new Error("لا توجد بيانات تشغيلية لاختبار Meta.");
  const created = await db.insert(stores).values({ name: "متجر اختبار Meta", slug: `meta-${randomUUID().slice(0, 12)}`, primaryOwnerUserId: owner.id });
  const storeId = Number(created[0].insertId);
  cleanupStoreIds.push(storeId);
  return { db, owner, storeId };
}

describe("Meta Connection Center", () => {
  it("يربط تشفير الرمز بسياق المتجر والغرض ولا يقبل فكّه في سياق آخر", async () => {
    const { storeId } = await setup();
    const context = metaConnectionTokenContext(storeId, "messaging");
    const encrypted = encryptMetaToken("token-super-secret", context);
    expect(encrypted).not.toContain("token-super-secret");
    expect(decryptMetaToken(encrypted, context)).toBe("token-super-secret");
    expect(() => decryptMetaToken(encrypted, metaConnectionTokenContext(storeId + 1, "messaging"))).toThrow();
  });

  it("يستهلك state صالحاً مرة واحدة ويرفض إعادة استخدامه", async () => {
    const { owner, storeId } = await setup();
    const state = randomUUID();
    await createMetaOAuthState({ state, storeId, userId: owner.id, purpose: "unified", authMode: "owner_direct", requestedScopes: ["pages_messaging"], expiresAt: new Date(Date.now() + 60_000) });
    const first = await consumeMetaOAuthState(state);
    expect(first).toMatchObject({ storeId, userId: owner.id, purpose: "unified", authMode: "owner_direct", requestedScopes: "pages_messaging" });
    expect(await consumeMetaOAuthState(state)).toBeNull();
  });

  it("لا يرسل config_id في Owner Direct ويحتفظ به لمسار العميل الخارجي فقط", () => {
    const common = { appId: "123456789", graphApiVersion: "v26.0", redirectUri: "https://example.com/api/meta/oauth/callback", state: "safe-state", scopes: ["pages_show_list", "pages_messaging"], configurationId: "config-external" };
    const ownerUrl = new URL(buildMetaAuthorizationUrl({ ...common, authMode: "owner_direct" }));
    expect(ownerUrl.searchParams.has("config_id")).toBe(false);
    expect(ownerUrl.searchParams.get("scope")).toContain("pages_show_list");
    const externalUrl = new URL(buildMetaAuthorizationUrl({ ...common, authMode: "external_business" }));
    expect(externalUrl.searchParams.get("config_id")).toBe("config-external");
    expect(externalUrl.searchParams.has("scope")).toBe(false);
  });

  it("يحفظ الرمز مشفراً ولا يعيده في ملخص الاتصال ويعزل الأصول حسب المتجر", async () => {
    const first = await setup();
    const second = await setup();
    const connection = await upsertMetaConnection({ storeId: first.storeId, purpose: "messaging", authMode: "owner_direct", accessToken: "live-meta-token", tokenExpiresAt: new Date(Date.now() + 3_600_000), grantedScopes: ["pages_messaging", "pages_show_list"], metaUserId: "meta-user-1", metaUserName: "مدير Meta", configurationId: null, connectedByUserId: first.owner.id });
    expect(connection.encryptedAccessToken).not.toBe("live-meta-token");
    await upsertDiscoveredMetaAssets({ storeId: first.storeId, connectionId: connection.id, purpose: "messaging", assets: [
      { assetType: "page", externalId: "page-1", displayName: "صفحة الاختبار", accessToken: "page-token-secret" },
      { assetType: "instagram", externalId: "ig-1", displayName: "@meta_test", parentExternalId: "page-1" },
    ] });
    const overview = await listMetaConnectionOverview(first.storeId);
    expect(overview.connections).toHaveLength(1);
    expect(overview.connections[0]).toMatchObject({ authMode: "owner_direct", configurationId: null });
    expect(overview.connections[0]).not.toHaveProperty("encryptedAccessToken");
    expect(JSON.stringify(overview)).not.toContain("live-meta-token");
    expect(JSON.stringify(overview)).not.toContain("page-token-secret");
    expect(overview.assets).toHaveLength(2);
    expect(await listMetaConnectionOverview(second.storeId)).toEqual({ connections: [], assets: [], capabilities: [] });
  });

  it("لا يختار أصلاً من متجر آخر ويعطل الرمز والاختيار عند الإبطال", async () => {
    const first = await setup();
    const second = await setup();
    const connection = await upsertMetaConnection({ storeId: first.storeId, purpose: "messaging", accessToken: "token-1", tokenExpiresAt: null, grantedScopes: ["pages_messaging"], metaUserId: "user-1", metaUserName: null, configurationId: null, connectedByUserId: first.owner.id });
    await upsertDiscoveredMetaAssets({ storeId: first.storeId, connectionId: connection.id, purpose: "messaging", assets: [{ assetType: "page", externalId: "page-select", displayName: "صفحة مختارة", accessToken: "page-token" }] });
    const [asset] = (await listMetaConnectionOverview(first.storeId)).assets;
    await expect(selectMetaAsset({ storeId: second.storeId, connectionId: connection.id, assetId: asset.id })).rejects.toThrow("لا ينتمي");
    const selected = await selectMetaAsset({ storeId: first.storeId, connectionId: connection.id, assetId: asset.id });
    expect(selected.isSelected).toBe(true);
    await configureChannelAccount({ storeId: first.storeId, actorUserId: first.owner.id, channel: "messenger", providerAccountId: selected.externalId, providerDisplayName: selected.displayName, connectionStatus: "testing" });
    expect(await disconnectMetaConnection(first.storeId, "messaging")).toBe(true);
    const [savedConnection] = await first.db.select().from(metaConnections).where(eq(metaConnections.id, connection.id));
    const [savedAsset] = await first.db.select().from(metaAssets).where(eq(metaAssets.id, asset.id));
    expect(savedConnection).toMatchObject({ status: "revoked", encryptedAccessToken: null });
    expect(savedAsset).toMatchObject({ isSelected: false, encryptedAccessToken: null });
  });

  it("يبني اتحاد صلاحيات موحداً بلا تكرار ويشفّر أسرار التطبيق بسياق مستقل", () => {
    expect(new Set(unifiedMetaScopes).size).toBe(unifiedMetaScopes.length);
    for (const scopes of Object.values(metaScopesByPurpose)) for (const scope of scopes) expect(unifiedMetaScopes).toContain(scope);
    const encrypted = encryptMetaToken("meta-app-secret", metaPlatformSecretContext("app-secret"));
    expect(encrypted).not.toContain("meta-app-secret");
    expect(decryptMetaToken(encrypted, metaPlatformSecretContext("app-secret"))).toBe("meta-app-secret");
    expect(() => decryptMetaToken(encrypted, metaPlatformSecretContext("webhook-verify-token"))).toThrow();
  });

  it("يحفظ اختيار عدة صفحات وحسابات إعلانية ويشغّل أو يعطل قدرة فعلية فوق اتصال واحد", async () => {
    const { db, owner, storeId } = await setup();
    const connection = await upsertMetaConnection({ storeId, purpose: "unified", accessToken: "unified-token", tokenExpiresAt: null, grantedScopes: unifiedMetaScopes, metaUserId: "unified-user", metaUserName: "مدير موحد", configurationId: "unified-config", connectedByUserId: owner.id });
    await upsertDiscoveredMetaAssets({ storeId, connectionId: connection.id, purpose: "unified", assets: [
      { assetType: "page", externalId: "page-a", displayName: "الصفحة الأولى", accessToken: "page-token-a" },
      { assetType: "page", externalId: "page-b", displayName: "الصفحة الثانية", accessToken: "page-token-b" },
      { assetType: "ad_account", externalId: "act-1", displayName: "حساب الإعلانات" },
    ] });
    const assets = (await listMetaConnectionOverview(storeId)).assets;
    for (const asset of assets) await setMetaAssetSelection({ storeId, connectionId: connection.id, assetId: asset.id, selected: true });
    await syncMetaConnectionCapabilities({ storeId, connectionId: connection.id, grantedScopes: unifiedMetaScopes });
    const overview = await listMetaConnectionOverview(storeId);
    expect(overview.assets.filter(asset => asset.assetType === "page" && asset.isSelected)).toHaveLength(2);
    expect(overview.capabilities.find(capability => capability.purpose === "ads_read")).toMatchObject({ status: "ready", enabled: true });
    await setMetaCapabilityEnabled({ storeId, connectionId: connection.id, purpose: "ads_read", enabled: false });
    const [disabled] = await db.select().from(metaConnectionCapabilities).where(eq(metaConnectionCapabilities.connectionId, connection.id));
    expect((await listMetaConnectionOverview(storeId)).capabilities.find(capability => capability.purpose === "ads_read")).toMatchObject({ status: "disabled", enabled: false });
    expect(disabled).toBeTruthy();
  });

  it("ينقل اختيارات الأصول المتطابقة من الاتصال القديم إلى الموحد دون حذف القديم", async () => {
    const { owner, storeId } = await setup();
    const legacy = await upsertMetaConnection({ storeId, purpose: "messaging", accessToken: "legacy-token", tokenExpiresAt: null, grantedScopes: ["pages_messaging"], metaUserId: "legacy-user", metaUserName: null, configurationId: null, connectedByUserId: owner.id });
    await upsertDiscoveredMetaAssets({ storeId, connectionId: legacy.id, purpose: "messaging", assets: [{ assetType: "page", externalId: "page-shared", displayName: "صفحة مشتركة", accessToken: "legacy-page-token" }] });
    const legacyAsset = (await listMetaConnectionOverview(storeId)).assets.find(asset => asset.connectionId === legacy.id)!;
    await setMetaAssetSelection({ storeId, connectionId: legacy.id, assetId: legacyAsset.id, selected: true });
    const unified = await upsertMetaConnection({ storeId, purpose: "unified", accessToken: "unified-token", tokenExpiresAt: null, grantedScopes: unifiedMetaScopes, metaUserId: "unified-user", metaUserName: null, configurationId: "config", connectedByUserId: owner.id });
    await upsertDiscoveredMetaAssets({ storeId, connectionId: unified.id, purpose: "unified", assets: [{ assetType: "page", externalId: "page-shared", displayName: "صفحة مشتركة", accessToken: "unified-page-token" }] });
    expect(await carryLegacyMetaAssetSelections(storeId, unified.id)).toBe(1);
    const overview = await listMetaConnectionOverview(storeId);
    expect(overview.assets.find(asset => asset.connectionId === unified.id)).toMatchObject({ isSelected: true });
    expect(overview.connections.find(connection => connection.id === legacy.id)).toMatchObject({ status: "connected" });
  });

  it("لا يعود إلى رمز الرسائل القديم بعد وجود اتصال موحد مبطل", async () => {
    const { owner, storeId } = await setup();
    const legacy = await upsertMetaConnection({ storeId, purpose: "messaging", accessToken: "legacy-token", tokenExpiresAt: null, grantedScopes: ["pages_messaging"], metaUserId: "legacy-user", metaUserName: null, configurationId: null, connectedByUserId: owner.id });
    await upsertDiscoveredMetaAssets({ storeId, connectionId: legacy.id, purpose: "messaging", assets: [{ assetType: "page", externalId: "page-blocked", displayName: "صفحة قديمة", accessToken: "legacy-page-token" }] });
    const legacyAsset = (await listMetaConnectionOverview(storeId)).assets.find(asset => asset.connectionId === legacy.id)!;
    await setMetaAssetSelection({ storeId, connectionId: legacy.id, assetId: legacyAsset.id, selected: true });
    const account = await configureChannelAccount({ storeId, actorUserId: owner.id, channel: "messenger", providerAccountId: "page-blocked", providerDisplayName: "صفحة قديمة", connectionStatus: "testing" });
    await upsertMetaConnection({ storeId, purpose: "unified", accessToken: "new-token", tokenExpiresAt: null, grantedScopes: unifiedMetaScopes, metaUserId: "unified-user", metaUserName: null, configurationId: "config", connectedByUserId: owner.id });
    await disconnectMetaConnection(storeId, "unified");
    await expect(loadMetaCredential(storeId, account)).rejects.toThrow("اتصال Meta الموحد غير صالح");
  });

  it("يشفّر System User Token لكل متجر ولا يعيده في الملخص ويحذفه عند الإبطال", async () => {
    const { db, owner, storeId } = await setup();
    const connection = await upsertMetaConnection({ storeId, purpose: "unified", authMode: "owner_direct", accessToken: "owner-user-token", tokenExpiresAt: null, grantedScopes: unifiedMetaScopes, metaUserId: "owner-user", metaUserName: "مالك المحفظة", configurationId: null, connectedByUserId: owner.id });
    await saveMetaSystemUserToken({ storeId, token: "whatsapp-system-user-token-secret" });
    const [stored] = await db.select().from(metaConnections).where(eq(metaConnections.id, connection.id));
    expect(stored.encryptedSystemUserToken).not.toBe("whatsapp-system-user-token-secret");
    expect(await getMetaSystemUserToken(storeId)).toBe("whatsapp-system-user-token-secret");
    const overview = await listMetaConnectionOverview(storeId);
    expect(overview.connections[0]).not.toHaveProperty("encryptedSystemUserToken");
    expect(JSON.stringify(overview)).not.toContain("whatsapp-system-user-token-secret");
    expect(overview.connections[0]).toMatchObject({ systemUserTokenStatus: "ready" });
    expect(await revokeMetaSystemUserToken(storeId)).toBe(true);
    expect(await getMetaSystemUserToken(storeId)).toBeNull();
  });

  it("يفضّل اعتماد System User الدائم عند تحميل رمز إرسال WhatsApp", async () => {
    const { owner, storeId } = await setup();
    const connection = await upsertMetaConnection({ storeId, purpose: "unified", authMode: "owner_direct", accessToken: "temporary-owner-token", tokenExpiresAt: null, grantedScopes: unifiedMetaScopes, metaUserId: "owner-user", metaUserName: null, configurationId: null, connectedByUserId: owner.id });
    await upsertDiscoveredMetaAssets({ storeId, connectionId: connection.id, purpose: "unified", assets: [{ assetType: "whatsapp_phone", externalId: "phone-system-token", displayName: "رقم الاختبار" }] });
    const asset = (await listMetaConnectionOverview(storeId)).assets.find(item => item.externalId === "phone-system-token")!;
    await setMetaAssetSelection({ storeId, connectionId: connection.id, assetId: asset.id, selected: true });
    const account = await configureChannelAccount({ storeId, actorUserId: owner.id, channel: "whatsapp", providerAccountId: asset.externalId, providerDisplayName: asset.displayName, connectionStatus: "testing" });
    await saveMetaSystemUserToken({ storeId, token: "preferred-whatsapp-system-user-token" });
    await expect(loadMetaCredential(storeId, account)).resolves.toEqual({ accessToken: "preferred-whatsapp-system-user-token", providerAccountId: "phone-system-token" });
  });

  it("يبقي Owner Direct متصلاً عند نجاح الأصول الأساسية ووجود تحذير اكتشاف اختياري", async () => {
    const { owner, storeId, db } = await setup();
    const connection = await upsertMetaConnection({ storeId, purpose: "unified", authMode: "owner_direct", accessToken: "owner-token-with-partial-discovery", tokenExpiresAt: null, grantedScopes: unifiedMetaScopes, metaUserId: "owner-user", metaUserName: null, configurationId: null, connectedByUserId: owner.id });
    await markMetaConnectionVerified(connection.id, "WhatsApp: Requires business_management permission", { fatal: false });
    const [stored] = await db.select().from(metaConnections).where(eq(metaConnections.id, connection.id));
    expect(stored).toMatchObject({ status: "connected", lastError: "WhatsApp: Requires business_management permission" });
  });
});
