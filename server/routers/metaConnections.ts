import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import { configureChannelAccount } from "../channels/db";
import { getMetaEventHealth, getMetaRetryStatus, requeueMetaDeadLetters, retryDueMetaEvents } from "../channels/metaEvents";
import { carryLegacyMetaAssetSelections, createMetaOAuthState, disconnectMetaConnection, getMetaAssetAccessToken, getMetaConnection, getMetaSystemUserToken, listMetaConnectionOverview, markMetaConnectionVerified, markMetaSystemUserTokenStatus, metaPurposes, revokeMetaSystemUserToken, saveMetaSystemUserToken, selectMetaAsset, setMetaAssetSelection, setMetaCapabilityEnabled, syncMetaConnectionCapabilities, upsertDiscoveredMetaAssets } from "../integrations/meta/db";
import { decryptMetaToken, metaConnectionTokenContext } from "../integrations/meta/tokenCipher";
import { createMetaAuthorizationUrl, discoverMetaAssets, ensureMetaPageWebhookSubscription, inspectMetaToken, metaConfigurationId, metaScopesByPurpose, subscribeMessengerPage, unifiedMetaScopes } from "../integrations/meta/oauth";
import { getMetaRuntimeSettings } from "../integrations/meta/platformSettings";

const purposeSchema = z.enum(metaPurposes);

async function requireStore(ctx: { user: NonNullable<any>; operationalStore: { id: number } | null }) {
  if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
  await assertPermission(ctx.user, "settings.manage", ctx.operationalStore.id);
  return ctx.operationalStore;
}

async function ensureSelectedMessengerPageSubscriptions(storeId: number, connectionId: number) {
  const overview = await listMetaConnectionOverview(storeId);
  const pages = overview.assets.filter(asset => asset.connectionId === connectionId && asset.assetType === "page" && asset.isSelected);
  if (!pages.length) return [] as string[];
  const failures: string[] = [];
  try {
    await ensureMetaPageWebhookSubscription();
  } catch (error) {
    failures.push(`Webhook التطبيق: ${error instanceof Error ? error.message : "تعذر الاشتراك"}`);
    return failures;
  }
  for (const page of pages) {
    try {
      const pageToken = await getMetaAssetAccessToken({ storeId, connectionId, assetId: page.id });
      await subscribeMessengerPage(page.externalId, pageToken);
    } catch (error) {
      failures.push(`${page.displayName || page.externalId}: ${error instanceof Error ? error.message : "تعذر اشتراك الصفحة"}`);
    }
  }
  return failures;
}

export const metaConnectionsRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const [connectionOverview, eventHealth, retryStatus, runtime] = await Promise.all([listMetaConnectionOverview(store.id), getMetaEventHealth(store.id), getMetaRetryStatus(), getMetaRuntimeSettings()]);
    const unifiedConnection = connectionOverview.connections.find(connection => connection.purpose === "unified") ?? null;
    const selectedAssetCount = connectionOverview.assets.filter(asset => asset.connectionId === unifiedConnection?.id && asset.isSelected).length;
    return {
      ...connectionOverview,
      eventHealth,
      retryStatus,
      configured: Boolean(runtime.appId && runtime.appSecret && ENV.metaRedirectUri),
      callbackUrl: ENV.metaRedirectUri || "/api/meta/oauth/callback",
      graphVersion: runtime.graphApiVersion,
      purposes: metaPurposes.map(purpose => ({ purpose, scopes: metaScopesByPurpose[purpose], configurationIdConfigured: Boolean(runtime.businessLoginConfigurationId) })),
      unified: {
        connection: unifiedConnection,
        selectedAssetCount,
        status: unifiedConnection?.status ?? "not_connected",
        metaUserName: unifiedConnection?.metaUserName ?? null,
        lastVerifiedAt: unifiedConnection?.lastVerifiedAt ?? null,
      },
    };
  }),
  beginUnifiedAuthorization: protectedProcedure.mutation(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const runtime = await getMetaRuntimeSettings();
    if (!runtime.appId || !runtime.appSecret || !ENV.metaRedirectUri) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "أكمل إعداد تطبيق Meta المركزي واختبره قبل بدء الربط." });
    const state = randomBytes(32).toString("base64url");
    await createMetaOAuthState({ state, storeId: store.id, userId: ctx.user.id, purpose: "unified", authMode: "owner_direct", requestedScopes: unifiedMetaScopes, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_connection", entityId: "unified", action: "meta.owner_direct_started", summary: "بدأ ربط أصول محفظة مالك تطبيق Meta بتسجيل دخول إداري مباشر." });
    return { authorizationUrl: await createMetaAuthorizationUrl({ state, purpose: "unified", authMode: "owner_direct" }) };
  }),
  beginExternalBusinessAuthorization: protectedProcedure.mutation(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const runtime = await getMetaRuntimeSettings();
    if (!runtime.appId || !runtime.appSecret || !runtime.businessLoginConfigurationId || !ENV.metaRedirectUri) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "أدخل Business Login Configuration ID قبل ربط محفظة عميل خارجي." });
    const state = randomBytes(32).toString("base64url");
    await createMetaOAuthState({ state, storeId: store.id, userId: ctx.user.id, purpose: "unified", authMode: "external_business", requestedScopes: unifiedMetaScopes, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_connection", entityId: "unified", action: "meta.external_business_started", summary: "بدأ ربط محفظة عميل خارجي عبر Facebook Login for Business." });
    return { authorizationUrl: await createMetaAuthorizationUrl({ state, purpose: "unified", authMode: "external_business" }) };
  }),
  repairUnifiedAuthorization: protectedProcedure.input(z.object({ focusPurpose: purposeSchema.optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const connection = await getMetaConnection(store.id, "unified");
    const authMode = connection?.authMode ?? "owner_direct";
    const state = randomBytes(32).toString("base64url");
    await createMetaOAuthState({ state, storeId: store.id, userId: ctx.user.id, purpose: "unified", authMode, requestedScopes: unifiedMetaScopes, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_connection", entityId: "unified", action: "meta.unified_repair_started", summary: `بدأ إصلاح صلاحيات اتصال Meta الموحد${input.focusPurpose ? ` لقدرة ${input.focusPurpose}` : ""}.` });
    return { authorizationUrl: await createMetaAuthorizationUrl({ state, purpose: "unified", authMode, rerequest: true }) };
  }),
  refreshUnifiedAssets: protectedProcedure.mutation(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const connection = await getMetaConnection(store.id, "unified");
    if (!connection?.encryptedAccessToken || connection.status === "revoked") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "اربط Meta مرة واحدة قبل تحديث الأصول." });
    const token = decryptMetaToken(connection.encryptedAccessToken, metaConnectionTokenContext(store.id, "unified"));
    const discovered = await discoverMetaAssets(token, "unified");
    await upsertDiscoveredMetaAssets({ storeId: store.id, connectionId: connection.id, purpose: "unified", assets: discovered.assets });
    await carryLegacyMetaAssetSelections(store.id, connection.id);
    await syncMetaConnectionCapabilities({ storeId: store.id, connectionId: connection.id, grantedScopes: connection.grantedScopes.split(",").filter(Boolean) });
    const subscriptionWarnings = await ensureSelectedMessengerPageSubscriptions(store.id, connection.id);
    const selectedPage = (await listMetaConnectionOverview(store.id)).assets.find(asset => asset.connectionId === connection.id && asset.assetType === "page" && asset.isSelected);
    if (selectedPage) await configureChannelAccount({ storeId: store.id, actorUserId: ctx.user.id, channel: "messenger", providerAccountId: selectedPage.externalId, providerDisplayName: selectedPage.displayName, connectionStatus: subscriptionWarnings.length ? "testing" : "connected" });
    const warnings = [...discovered.failures, ...subscriptionWarnings];
    await markMetaConnectionVerified(
      connection.id,
      warnings.length ? warnings.join(" | ").slice(0, 500) : null,
      { fatal: false },
    );
    return { discovered: discovered.assets.length, warnings };
  }),
  setAssetSelection: protectedProcedure.input(z.object({ connectionId: z.number().int().positive(), assetId: z.number().int().positive(), selected: z.boolean() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const asset = await setMetaAssetSelection({ storeId: store.id, ...input });
    const subscriptionWarnings = input.selected && asset.assetType === "page" ? await ensureSelectedMessengerPageSubscriptions(store.id, input.connectionId) : [];
    const channel = asset.connectionPurpose === "unified" || asset.connectionPurpose === "messaging" ? (asset.assetType === "whatsapp_phone" ? "whatsapp" : asset.assetType === "instagram" ? "instagram" : asset.assetType === "page" ? "messenger" : null) : null;
    if (channel) {
      const latest = await listMetaConnectionOverview(store.id);
      const compatibleType = channel === "whatsapp" ? "whatsapp_phone" : channel === "instagram" ? "instagram" : "page";
      const fallback = latest.assets.find(item => item.connectionId === input.connectionId && item.assetType === compatibleType && item.isSelected);
      const active = input.selected ? asset : fallback;
      await configureChannelAccount({ storeId: store.id, actorUserId: ctx.user.id, channel, providerAccountId: active?.externalId ?? null, providerDisplayName: active?.displayName ?? null, connectionStatus: active ? (channel === "messenger" && !subscriptionWarnings.length ? "connected" : "testing") : "disabled" });
    }
    await syncMetaConnectionCapabilities({ storeId: store.id, connectionId: input.connectionId, grantedScopes: asset.grantedScopes.split(",").filter(Boolean) });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_asset", entityId: asset.id, action: input.selected ? "meta.asset_enabled" : "meta.asset_disabled", summary: `${input.selected ? "تم تفعيل" : "تم استبعاد"} أصل Meta من نوع ${asset.assetType} داخل المتجر.` });
    return { ...asset, channel, subscriptionWarnings };
  }),
  setAssetSelections: protectedProcedure.input(z.object({ connectionId: z.number().int().positive(), assetIds: z.array(z.number().int().positive()).min(1).max(100), selected: z.boolean() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const uniqueAssetIds = Array.from(new Set(input.assetIds));
    let grantedScopes = "";
    for (const assetId of uniqueAssetIds) {
      const asset = await setMetaAssetSelection({ storeId: store.id, connectionId: input.connectionId, assetId, selected: input.selected });
      grantedScopes = asset.grantedScopes;
    }
    const latest = await listMetaConnectionOverview(store.id);
    const selected = latest.assets.filter(asset => asset.connectionId === input.connectionId && asset.isSelected);
    const subscriptionWarnings = await ensureSelectedMessengerPageSubscriptions(store.id, input.connectionId);
    const channelTypes = [{ channel: "whatsapp" as const, assetType: "whatsapp_phone" as const }, { channel: "instagram" as const, assetType: "instagram" as const }, { channel: "messenger" as const, assetType: "page" as const }];
    for (const item of channelTypes) {
      const active = selected.find(asset => asset.assetType === item.assetType);
      await configureChannelAccount({ storeId: store.id, actorUserId: ctx.user.id, channel: item.channel, providerAccountId: active?.externalId ?? null, providerDisplayName: active?.displayName ?? null, connectionStatus: active ? (item.channel === "messenger" && !subscriptionWarnings.length ? "connected" : "testing") : "disabled" });
    }
    await syncMetaConnectionCapabilities({ storeId: store.id, connectionId: input.connectionId, grantedScopes: grantedScopes.split(",").filter(Boolean) });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_assets", entityId: String(input.connectionId), action: input.selected ? "meta.assets_bulk_enabled" : "meta.assets_bulk_disabled", summary: `${input.selected ? "تم تفعيل" : "تم استبعاد"} ${uniqueAssetIds.length} من أصول Meta دفعة واحدة.` });
    return { updated: uniqueAssetIds.length, selected: input.selected, subscriptionWarnings };
  }),
  setCapabilityEnabled: protectedProcedure.input(z.object({ connectionId: z.number().int().positive(), purpose: purposeSchema, enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const capability = await setMetaCapabilityEnabled({ storeId: store.id, ...input });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_capability", entityId: input.purpose, action: input.enabled ? "meta.capability_enabled" : "meta.capability_disabled", summary: `${input.enabled ? "تم تفعيل" : "تم تعطيل"} قدرة Meta ${input.purpose} داخل المتجر.` });
    return capability;
  }),
  disconnectUnified: protectedProcedure.input(z.object({ confirm: z.literal(true) })).mutation(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const disconnected = await disconnectMetaConnection(store.id, "unified");
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_connection", entityId: "unified", action: "meta.unified_revoked", summary: "تم إبطال اتصال Meta الموحد وحذف رمز الوصول المشفر وتعطيل أصوله وقدراته." });
    return { disconnected };
  }),
  saveWhatsAppSystemUserToken: protectedProcedure.input(z.object({ token: z.string().trim().min(20).max(4000) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const inspection = await inspectMetaToken(input.token);
    const requiredScopes = ["whatsapp_business_management", "whatsapp_business_messaging"];
    const missingScopes = requiredScopes.filter(scope => !inspection.scopes.includes(scope));
    if (missingScopes.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `رمز System User لا يملك صلاحيات WhatsApp المطلوبة: ${missingScopes.join(", ")}` });
    const result = await saveMetaSystemUserToken({ storeId: store.id, token: input.token });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_connection", entityId: "whatsapp_system_user", action: "meta.whatsapp_system_token_saved", summary: "تم اختبار وحفظ اعتماد WhatsApp الدائم بصورة مشفرة من دون تسجيل قيمة الرمز." });
    return { status: result.status, testedAt: result.testedAt, scopes: requiredScopes };
  }),
  testWhatsAppSystemUserToken: protectedProcedure.mutation(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const token = await getMetaSystemUserToken(store.id);
    if (!token) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لا يوجد System User Token صالح محفوظ لهذا المتجر." });
    try {
      const inspection = await inspectMetaToken(token);
      const requiredScopes = ["whatsapp_business_management", "whatsapp_business_messaging"];
      const missingScopes = requiredScopes.filter(scope => !inspection.scopes.includes(scope));
      if (missingScopes.length) throw new Error(`الصلاحيات الناقصة: ${missingScopes.join(", ")}`);
      await markMetaSystemUserTokenStatus(store.id, "ready");
      return { status: "ready" as const, scopes: requiredScopes };
    } catch (error) {
      await markMetaSystemUserTokenStatus(store.id, "invalid");
      throw new TRPCError({ code: "BAD_GATEWAY", message: error instanceof Error ? error.message : "تعذر اختبار اعتماد WhatsApp الدائم." });
    }
  }),
  revokeWhatsAppSystemUserToken: protectedProcedure.input(z.object({ confirm: z.literal(true) })).mutation(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const revoked = await revokeMetaSystemUserToken(store.id);
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_connection", entityId: "whatsapp_system_user", action: "meta.whatsapp_system_token_revoked", summary: "تم إبطال اعتماد WhatsApp الدائم وحذف قيمته المشفرة." });
    return { revoked };
  }),
  beginAuthorization: protectedProcedure.input(z.object({ purpose: purposeSchema })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const runtime = await getMetaRuntimeSettings();
    if (!runtime.appId || !runtime.appSecret || !ENV.metaRedirectUri) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "أكمل إعداد تطبيق Meta المركزي ورابط العودة قبل بدء التفويض." });
    const state = randomBytes(32).toString("base64url");
    await createMetaOAuthState({ state, storeId: store.id, userId: ctx.user.id, purpose: input.purpose, authMode: "external_business", requestedScopes: metaScopesByPurpose[input.purpose], expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    return { authorizationUrl: await createMetaAuthorizationUrl({ state, purpose: input.purpose, authMode: "external_business" }) };
  }),
  refreshAssets: protectedProcedure.input(z.object({ purpose: purposeSchema })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const connection = await getMetaConnection(store.id, input.purpose);
    if (!connection?.encryptedAccessToken || connection.status === "revoked") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "أعد تفويض هذا النطاق قبل تحديث الأصول." });
    try {
      const token = decryptMetaToken(connection.encryptedAccessToken, metaConnectionTokenContext(store.id, input.purpose));
      const discovered = await discoverMetaAssets(token, input.purpose);
      await upsertDiscoveredMetaAssets({ storeId: store.id, connectionId: connection.id, purpose: input.purpose, assets: discovered.assets });
      await markMetaConnectionVerified(connection.id, discovered.failures.length ? discovered.failures.join(" | ").slice(0, 500) : null);
      return { discovered: discovered.assets.length, warnings: discovered.failures };
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر تحديث أصول Meta.";
      await markMetaConnectionVerified(connection.id, message);
      throw new TRPCError({ code: "BAD_GATEWAY", message });
    }
  }),
  selectAsset: protectedProcedure.input(z.object({ connectionId: z.number().int().positive(), assetId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const asset = await selectMetaAsset({ storeId: store.id, connectionId: input.connectionId, assetId: input.assetId });
    const channel = asset.connectionPurpose === "messaging" ? (asset.assetType === "whatsapp_phone" ? "whatsapp" : asset.assetType === "instagram" ? "instagram" : asset.assetType === "page" ? "messenger" : null) : null;
    if (channel) await configureChannelAccount({ storeId: store.id, actorUserId: ctx.user.id, channel, providerAccountId: asset.externalId, providerDisplayName: asset.displayName, connectionStatus: "testing" });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_asset", entityId: asset.id, action: "meta.asset_selected", summary: `تم اختيار أصل Meta من نوع ${asset.assetType} للمتجر.` });
    return { ...asset, channel };
  }),
  disconnect: protectedProcedure.input(z.object({ purpose: purposeSchema, confirm: z.literal(true) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const disconnected = await disconnectMetaConnection(store.id, input.purpose);
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_connection", entityId: input.purpose, action: "meta.connection_revoked", summary: `تم إبطال اتصال Meta لنطاق ${input.purpose} وحذف الرمز المشفر محلياً.` });
    return { disconnected };
  }),
  retryFailedEvents: protectedProcedure.input(z.object({ includeDeadLetters: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const requeued = input.includeDeadLetters ? await requeueMetaDeadLetters(store.id) : 0;
    const result = await retryDueMetaEvents(30);
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_webhook", entityId: store.id, action: "meta.webhook_retry_requested", summary: `طلب إعادة معالجة أحداث Meta؛ أعيد ${requeued} من dead-letter وعولج ${result.attempted}.` });
    return { requeued, ...result };
  }),
});
