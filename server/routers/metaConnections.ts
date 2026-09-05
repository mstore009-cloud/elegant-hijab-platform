import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import { configureChannelAccount, listChannelAccounts, updateChannelSubscriptionHealth } from "../channels/db";
import { getMetaEventHealth, getMetaRetryStatus, requeueMetaDeadLetters, retryDueMetaEvents } from "../channels/metaEvents";
import { carryLegacyMetaAssetSelections, consumeMetaOAuthState, createMetaOAuthState, disconnectMetaConnection, getMetaAssetAccessToken, getMetaConnection, getMetaSystemUserToken, listMetaConnectionOverview, markMetaConnectionVerified, markMetaSystemUserTokenStatus, metaPurposes, revokeMetaSystemUserToken, saveMetaSystemUserToken, selectMetaAsset, setMetaAssetSelection, setMetaCapabilityEnabled, syncMetaConnectionCapabilities, upsertDiscoveredMetaAssets } from "../integrations/meta/db";
import { decryptMetaToken, metaConnectionTokenContext } from "../integrations/meta/tokenCipher";
import { createMetaAuthorizationUrl, discoverMetaAssets, discoverOwnedWhatsAppAssets, ensureMetaPageWebhookSubscription, ensureMetaPlatformWebhookSubscriptions, exchangeWhatsAppEmbeddedSignupCode, getActiveMetaTemplateScopes, inspectInstagramPageWebhookSubscription, inspectMessengerPageWebhookSubscription, inspectMetaToken, inspectWhatsAppBusinessPhone, metaConfigurationId, metaScopesByPurpose, requestWhatsAppSmbData, subscribeMessengerPage, subscribeWhatsAppBusinessAccount } from "../integrations/meta/oauth";
import { getMetaRuntimeSettings } from "../integrations/meta/platformSettings";
import { enableWhatsAppHistorySyncJob, ensureMetaHistorySyncJobs, listMetaHistorySyncJobs, processDueMetaHistorySyncJobs, processMetaHistorySyncJob, setMetaHistorySyncStatus } from "../integrations/meta/historySync";
import { listWhatsAppOnboardings, markWhatsAppSyncRequested, upsertWhatsAppOnboarding } from "../integrations/meta/whatsappCoexistence";
import { getWhatsAppHistoryChunkHealth, processDueWhatsAppHistoryChunks } from "../integrations/meta/whatsappHistoryWebhook";

const purposeSchema = z.enum(metaPurposes);

async function requireStore(ctx: { user: NonNullable<any>; operationalStore: { id: number } | null }) {
  if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
  await assertPermission(ctx.user, "settings.manage", ctx.operationalStore.id);
  return ctx.operationalStore;
}

function requirePlatformAdminUser(ctx: { user: NonNullable<any> }) {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "هذا المسار مخصص لمدير المنصة." });
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

async function ensureSelectedInstagramSubscriptions(storeId: number, connectionId: number) {
  const overview = await listMetaConnectionOverview(storeId);
  const instagramAccounts = overview.assets.filter(asset => asset.connectionId === connectionId && asset.assetType === "instagram" && asset.isSelected);
  if (!instagramAccounts.length) return [] as string[];
  const failures: string[] = [];
  for (const instagram of instagramAccounts) {
    const page = overview.assets.find(asset => asset.connectionId === connectionId && asset.assetType === "page" && asset.externalId === instagram.parentExternalId);
    if (!page) {
      failures.push(`${instagram.displayName || instagram.externalId}: لا توجد صفحة Facebook مرتبطة.`);
      continue;
    }
    try {
      const pageToken = await getMetaAssetAccessToken({ storeId, connectionId, assetId: page.id });
      await subscribeMessengerPage(page.externalId, pageToken);
      const health = await inspectInstagramPageWebhookSubscription(page.externalId, pageToken);
      if (!health.assetReady) {
        failures.push(`${instagram.displayName || instagram.externalId}: ربط الصفحة المرتبطة غير مكتمل${health.missingPageFields.length ? `: ${health.missingPageFields.join(", ")}` : ""}`);
      }
    } catch (error) {
      failures.push(`${instagram.displayName || instagram.externalId}: ${error instanceof Error ? error.message : "تعذر تثبيت التطبيق على الصفحة المرتبطة"}`);
    }
  }
  return failures;
}

async function ensureSelectedWhatsAppSubscriptions(storeId: number, connectionId: number) {
  const overview = await listMetaConnectionOverview(storeId);
  const connection = await getMetaConnection(storeId, "unified");
  if (!connection?.encryptedAccessToken || connection.id !== connectionId) return [] as string[];
  const selectedPhones = overview.assets.filter(asset => asset.connectionId === connectionId && asset.assetType === "whatsapp_phone" && asset.isSelected);
  const selectedWabaIds = new Set([
    ...overview.assets.filter(asset => asset.connectionId === connectionId && asset.assetType === "whatsapp_business" && asset.isSelected).map(asset => asset.externalId),
    ...selectedPhones.map(asset => asset.parentExternalId).filter((value): value is string => Boolean(value)),
  ]);
  if (!selectedWabaIds.size) return [] as string[];
  const accessToken = (await getMetaSystemUserToken(storeId)) || decryptMetaToken(connection.encryptedAccessToken, metaConnectionTokenContext(storeId, "unified"));
  const failures: string[] = [];
  for (const wabaId of Array.from(selectedWabaIds)) {
    try { await subscribeWhatsAppBusinessAccount(wabaId, accessToken); }
    catch (error) { failures.push(`${wabaId}: ${error instanceof Error ? error.message : "تعذر اشتراك WhatsApp"}`); }
  }
  return failures;
}

export const metaConnectionsRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const [connectionOverview, eventHealth, retryStatus, runtime, channelAccounts, historySyncJobs, whatsappOnboardings, whatsappHistoryChunkHealth] = await Promise.all([listMetaConnectionOverview(store.id), getMetaEventHealth(store.id), getMetaRetryStatus(), getMetaRuntimeSettings(), listChannelAccounts(store.id), listMetaHistorySyncJobs(store.id), listWhatsAppOnboardings(store.id), getWhatsAppHistoryChunkHealth(store.id)]);
    const unifiedConnection = connectionOverview.connections.find(connection => connection.purpose === "unified") ?? null;
    const selectedAssetCount = connectionOverview.assets.filter(asset => asset.connectionId === unifiedConnection?.id && asset.isSelected).length;
    return {
      ...connectionOverview,
      eventHealth,
      retryStatus,
      channelAccounts,
      historySyncJobs,
      whatsappOnboardings,
      whatsappHistoryChunkHealth,
      platformAdmin: ctx.user.role === "admin",
      configured: Boolean(runtime.appId && runtime.appSecret && runtime.publicBaseUrl),
      callbackUrl: runtime.publicBaseUrl ? `${runtime.publicBaseUrl}/api/meta/oauth/callback` : "/api/meta/oauth/callback",
      graphVersion: runtime.graphApiVersion,
      activeTemplateVersion: runtime.activeTemplateVersion,
      purposes: metaPurposes.map(purpose => ({ purpose, scopes: metaScopesByPurpose[purpose], configurationIdConfigured: Boolean(runtime.businessLoginConfigurationId) })),
      unified: {
        connection: unifiedConnection,
        selectedAssetCount,
        status: unifiedConnection?.status ?? "not_connected",
        metaUserName: unifiedConnection?.metaUserName ?? null,
        lastVerifiedAt: unifiedConnection?.lastVerifiedAt ?? null,
        templateVersion: unifiedConnection?.templateVersion ?? null,
        templateOutdated: Boolean(unifiedConnection && unifiedConnection.templateVersion !== runtime.activeTemplateVersion),
      },
    };
  }),
  beginUnifiedAuthorization: protectedProcedure.mutation(async ({ ctx }) => {
    requirePlatformAdminUser(ctx);
    const store = await requireStore(ctx);
    const runtime = await getMetaRuntimeSettings();
    if (!runtime.appId || !runtime.appSecret || !runtime.publicBaseUrl) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "أكمل إعداد تطبيق Meta المركزي واختبره قبل بدء الربط." });
    const state = randomBytes(32).toString("base64url");
    const requestedScopes = await getActiveMetaTemplateScopes("unified");
    await createMetaOAuthState({ state, storeId: store.id, userId: ctx.user.id, purpose: "unified", authMode: "owner_direct", templateVersion: runtime.activeTemplateVersion, requestedScopes, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_connection", entityId: "unified", action: "meta.owner_direct_started", summary: "بدأ ربط أصول محفظة مالك تطبيق Meta بتسجيل دخول إداري مباشر." });
    return { authorizationUrl: await createMetaAuthorizationUrl({ state, purpose: "unified", authMode: "owner_direct" }) };
  }),
  beginExternalBusinessAuthorization: protectedProcedure.mutation(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const runtime = await getMetaRuntimeSettings();
    if (!runtime.appId || !runtime.appSecret || !runtime.businessLoginConfigurationId || !runtime.publicBaseUrl) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "أدخل Business Login Configuration ID وانشر قالب Meta قبل ربط متجر جديد." });
    const state = randomBytes(32).toString("base64url");
    const requestedScopes = await getActiveMetaTemplateScopes("unified");
    await createMetaOAuthState({ state, storeId: store.id, userId: ctx.user.id, purpose: "unified", authMode: "external_business", templateVersion: runtime.activeTemplateVersion, requestedScopes, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_connection", entityId: "unified", action: "meta.external_business_started", summary: "بدأ ربط محفظة عميل خارجي عبر Facebook Login for Business." });
    return { authorizationUrl: await createMetaAuthorizationUrl({ state, purpose: "unified", authMode: "external_business" }) };
  }),
  beginWhatsAppEmbeddedSignup: protectedProcedure.mutation(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const runtime = await getMetaRuntimeSettings();
    const connection = await getMetaConnection(store.id, "unified");
    if (!connection || connection.status !== "connected") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "أكمل ربط Meta الموحد أولاً قبل ربط WhatsApp." });
    if (!runtime.appId || !runtime.whatsappEmbeddedSignupConfigurationId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "انشر WhatsApp Embedded Signup Configuration ID داخل إعداد قالب Meta أولاً." });
    const state = randomBytes(32).toString("base64url");
    await createMetaOAuthState({ state, storeId: store.id, userId: ctx.user.id, purpose: "unified", authMode: "external_business", flowType: "whatsapp_embedded_signup", templateVersion: runtime.activeTemplateVersion, requestedScopes: ["whatsapp_business_management", "whatsapp_business_messaging"], expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_connection", entityId: "whatsapp_embedded_signup", action: "meta.whatsapp_embedded_signup_started", summary: "بدأ المتجر WhatsApp Embedded Signup من قالب Meta المركزي." });
    return { appId: runtime.appId, graphApiVersion: runtime.graphApiVersion, configurationId: runtime.whatsappEmbeddedSignupConfigurationId, state, featureType: "whatsapp_business_app_onboarding" as const, sessionInfoVersion: "3" as const };
  }),
  completeWhatsAppEmbeddedSignup: protectedProcedure.input(z.object({ state: z.string().min(20).max(200), code: z.string().min(8).max(4000), wabaId: z.string().trim().min(3).max(255), phoneNumberId: z.string().trim().min(3).max(255) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const oauthState = await consumeMetaOAuthState(input.state);
    if (!oauthState || oauthState.storeId !== store.id || oauthState.userId !== ctx.user.id || oauthState.flowType !== "whatsapp_embedded_signup") throw new TRPCError({ code: "BAD_REQUEST", message: "انتهت جلسة WhatsApp Embedded Signup أو لا تخص هذا المتجر." });
    const connection = await getMetaConnection(store.id, "unified");
    if (!connection || connection.status !== "connected") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "اتصال Meta الموحد غير متصل لهذا المتجر." });
    try {
      const exchanged = await exchangeWhatsAppEmbeddedSignupCode(input.code);
      const [inspection, phone] = await Promise.all([inspectMetaToken(exchanged.accessToken), inspectWhatsAppBusinessPhone(input.phoneNumberId, exchanged.accessToken)]);
      await subscribeWhatsAppBusinessAccount(input.wabaId, exchanged.accessToken);
      await upsertDiscoveredMetaAssets({ storeId: store.id, connectionId: connection.id, purpose: "unified", assets: [
        { assetType: "whatsapp_business", externalId: input.wabaId, displayName: "WhatsApp Business", accessToken: exchanged.accessToken },
        { assetType: "whatsapp_phone", externalId: input.phoneNumberId, displayName: phone.verifiedName || phone.displayPhoneNumber || "WhatsApp", parentExternalId: input.wabaId, metadata: { displayPhoneNumber: phone.displayPhoneNumber, isOnBizApp: phone.isOnBizApp, platformType: phone.platformType }, accessToken: exchanged.accessToken },
      ] });
      const latest = await listMetaConnectionOverview(store.id);
      for (const asset of latest.assets.filter(asset => asset.connectionId === connection.id && [input.wabaId, input.phoneNumberId].includes(asset.externalId))) await setMetaAssetSelection({ storeId: store.id, connectionId: connection.id, assetId: asset.id, selected: true });
      const onboarding = await upsertWhatsAppOnboarding({ storeId: store.id, connectionId: connection.id, wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, displayPhoneNumber: phone.displayPhoneNumber, accessToken: exchanged.accessToken, tokenExpiresAt: inspection.expiresAt ?? (exchanged.expiresIn ? new Date(Date.now() + exchanged.expiresIn * 1000) : null), coexistenceMode: phone.isOnBizApp ? "coexistence" : "standard_cloud_api", actorUserId: ctx.user.id });
      const account = await configureChannelAccount({ storeId: store.id, actorUserId: ctx.user.id, channel: "whatsapp", providerAccountId: input.phoneNumberId, providerDisplayName: phone.verifiedName || phone.displayPhoneNumber, connectionStatus: "connected" });
      await enableWhatsAppHistorySyncJob({ storeId: store.id, connectionId: connection.id, channelAccountId: account.id, providerAccountId: input.phoneNumberId, actorUserId: ctx.user.id, coexistence: phone.isOnBizApp });
      let contactsRequestId: string | null = null;
      let historyRequestId: string | null = null;
      const warnings: string[] = [];
      if (phone.isOnBizApp) {
        try { contactsRequestId = (await requestWhatsAppSmbData({ phoneNumberId: input.phoneNumberId, accessToken: exchanged.accessToken, syncType: "smb_app_state_sync" })).requestId; } catch (error) { warnings.push(error instanceof Error ? error.message : "تعذرت مزامنة جهات اتصال WhatsApp"); }
        try { historyRequestId = (await requestWhatsAppSmbData({ phoneNumberId: input.phoneNumberId, accessToken: exchanged.accessToken, syncType: "history" })).requestId; } catch (error) { warnings.push(error instanceof Error ? error.message : "تعذرت مزامنة تاريخ WhatsApp"); }
        await markWhatsAppSyncRequested({ onboardingId: onboarding.id, contactsRequestId, historyRequestId });
      }
      await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "channel_account", entityId: `whatsapp:${input.phoneNumberId}`, action: "meta.whatsapp_embedded_signup_completed", summary: phone.isOnBizApp ? "اكتمل WhatsApp Coexistence وبدأ طلب مشاركة التاريخ." : "اكتمل WhatsApp Cloud API القياسي؛ التاريخ السابق غير متاح." });
      return { connected: true as const, coexistence: phone.isOnBizApp, displayPhoneNumber: phone.displayPhoneNumber, historyRequested: Boolean(historyRequestId), warnings };
    } catch (error) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: error instanceof Error ? error.message : "تعذر إكمال WhatsApp Embedded Signup." });
    }
  }),
  repairUnifiedAuthorization: protectedProcedure.input(z.object({ focusPurpose: purposeSchema.optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const connection = await getMetaConnection(store.id, "unified");
    const runtime = await getMetaRuntimeSettings();
    const authMode = connection?.authMode ?? "external_business";
    const state = randomBytes(32).toString("base64url");
    const requestedScopes = await getActiveMetaTemplateScopes("unified");
    await createMetaOAuthState({ state, storeId: store.id, userId: ctx.user.id, purpose: "unified", authMode, templateVersion: runtime.activeTemplateVersion, requestedScopes, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_connection", entityId: "unified", action: "meta.unified_repair_started", summary: `بدأ إصلاح صلاحيات اتصال Meta الموحد${input.focusPurpose ? ` لقدرة ${input.focusPurpose}` : ""}.` });
    return { authorizationUrl: await createMetaAuthorizationUrl({ state, purpose: "unified", authMode, rerequest: true }) };
  }),
  refreshUnifiedAssets: protectedProcedure.mutation(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const connection = await getMetaConnection(store.id, "unified");
    if (!connection?.encryptedAccessToken || connection.status === "revoked") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "اربط Meta مرة واحدة قبل تحديث الأصول." });
    const token = decryptMetaToken(connection.encryptedAccessToken, metaConnectionTokenContext(store.id, "unified"));
    const discovered = await discoverMetaAssets(token, "unified");
    const overviewBeforeOwnerWhatsApp = await listMetaConnectionOverview(store.id);
    const ownerBusinessIds = overviewBeforeOwnerWhatsApp.assets
      .filter(asset => asset.connectionId === connection.id && asset.assetType === "business" && asset.isSelected)
      .map(asset => asset.externalId);
    const systemUserToken = connection.authMode === "owner_direct" ? await getMetaSystemUserToken(store.id) : null;
    const ownerWhatsApp = connection.authMode !== "owner_direct"
      ? { assets: [], failures: [] as string[] }
      : !systemUserToken
        ? { assets: [], failures: ["WhatsApp: أضف System User Token صالحاً لاكتشاف أصول محفظة مالك التطبيق."] }
        : !ownerBusinessIds.length
          ? { assets: [], failures: ["WhatsApp: اختر Business Portfolio المالك أولاً من الأصول الموحدة."] }
          : await discoverOwnedWhatsAppAssets({ businessIds: ownerBusinessIds, accessToken: systemUserToken });
    await upsertDiscoveredMetaAssets({ storeId: store.id, connectionId: connection.id, purpose: "unified", assets: [...discovered.assets, ...ownerWhatsApp.assets] });
    await carryLegacyMetaAssetSelections(store.id, connection.id);
    await syncMetaConnectionCapabilities({ storeId: store.id, connectionId: connection.id, grantedScopes: connection.grantedScopes.split(",").filter(Boolean) });
    const messengerWarnings = await ensureSelectedMessengerPageSubscriptions(store.id, connection.id);
    const instagramWarnings = await ensureSelectedInstagramSubscriptions(store.id, connection.id);
    const whatsappWarnings = await ensureSelectedWhatsAppSubscriptions(store.id, connection.id);
    const subscriptionWarnings = [...messengerWarnings, ...instagramWarnings, ...whatsappWarnings];
    const selectedAssets = (await listMetaConnectionOverview(store.id)).assets.filter(asset => asset.connectionId === connection.id && asset.isSelected);
    const selectedPage = selectedAssets.find(asset => asset.assetType === "page");
    const selectedInstagram = selectedAssets.find(asset => asset.assetType === "instagram");
    if (selectedPage) await configureChannelAccount({ storeId: store.id, actorUserId: ctx.user.id, channel: "messenger", providerAccountId: selectedPage.externalId, providerDisplayName: selectedPage.displayName, connectionStatus: subscriptionWarnings.length ? "testing" : "connected" });
    if (selectedInstagram) {
      await configureChannelAccount({ storeId: store.id, actorUserId: ctx.user.id, channel: "instagram", providerAccountId: selectedInstagram.externalId, providerDisplayName: selectedInstagram.displayName, connectionStatus: "testing" });
      await updateChannelSubscriptionHealth({ storeId: store.id, channel: "instagram", appSubscriptionStatus: "unknown", assetSubscriptionStatus: instagramWarnings.length ? "error" : "ready", error: instagramWarnings.join(" | ") || null });
    }
    await ensureMetaHistorySyncJobs(store.id, ctx.user.id);
    const warnings = [...discovered.failures, ...ownerWhatsApp.failures, ...subscriptionWarnings];
    await markMetaConnectionVerified(
      connection.id,
      warnings.length ? warnings.join(" | ").slice(0, 500) : null,
      { fatal: false },
    );
    return { discovered: discovered.assets.length + ownerWhatsApp.assets.length, warnings, ownerWhatsApp: { discovered: ownerWhatsApp.assets.length, available: ownerWhatsApp.assets.some(asset => asset.assetType === "whatsapp_phone") } };
  }),
  repairMessengerReception: protectedProcedure.mutation(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const connection = await getMetaConnection(store.id, "unified");
    if (!connection || connection.status !== "connected") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "اربط Meta أولاً قبل إصلاح Messenger." });
    const overview = await listMetaConnectionOverview(store.id);
    const page = overview.assets.find(asset => asset.connectionId === connection.id && asset.assetType === "page" && asset.isSelected);
    if (!page) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "اختر صفحة Facebook أولاً." });
    await configureChannelAccount({ storeId: store.id, actorUserId: ctx.user.id, channel: "messenger", providerAccountId: page.externalId, providerDisplayName: page.displayName, connectionStatus: "testing" });
    try {
      const pageToken = await getMetaAssetAccessToken({ storeId: store.id, connectionId: connection.id, assetId: page.id });
      await ensureMetaPageWebhookSubscription();
      await subscribeMessengerPage(page.externalId, pageToken);
      const health = await inspectMessengerPageWebhookSubscription(page.externalId, pageToken);
      const error = health.appReady && health.assetReady ? null : `الاشتراك غير مكتمل${health.missingFields.length ? `: ${health.missingFields.join(", ")}` : ""}`;
      await updateChannelSubscriptionHealth({ storeId: store.id, channel: "messenger", appSubscriptionStatus: health.appReady ? "ready" : "error", assetSubscriptionStatus: health.assetReady ? "ready" : "error", error });
      await configureChannelAccount({ storeId: store.id, actorUserId: ctx.user.id, channel: "messenger", providerAccountId: page.externalId, providerDisplayName: page.displayName, connectionStatus: error ? "testing" : "connected" });
      await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "channel_account", entityId: `messenger:${page.externalId}`, action: "meta.messenger_reception_repaired", summary: error || "تم التحقق من اشتراك تطبيق Meta وصفحة Messenger بنجاح." });
      return health;
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر إصلاح استقبال Messenger.";
      await updateChannelSubscriptionHealth({ storeId: store.id, channel: "messenger", appSubscriptionStatus: "error", assetSubscriptionStatus: "error", error: message }).catch(() => undefined);
      throw new TRPCError({ code: "BAD_GATEWAY", message });
    }
  }),
  repairInstagramReception: protectedProcedure.mutation(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const connection = await getMetaConnection(store.id, "unified");
    if (!connection || connection.status !== "connected") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "اربط Meta أولاً قبل إصلاح Instagram." });
    const overview = await listMetaConnectionOverview(store.id);
    const instagram = overview.assets.find(asset => asset.connectionId === connection.id && asset.assetType === "instagram" && asset.isSelected);
    if (!instagram) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "اختر حساب Instagram أولاً." });
    await configureChannelAccount({ storeId: store.id, actorUserId: ctx.user.id, channel: "instagram", providerAccountId: instagram.externalId, providerDisplayName: instagram.displayName, connectionStatus: "testing" });
    const failures = await ensureSelectedInstagramSubscriptions(store.id, connection.id);
    const error = failures.join(" | ") || null;
    await updateChannelSubscriptionHealth({ storeId: store.id, channel: "instagram", appSubscriptionStatus: "unknown", assetSubscriptionStatus: failures.length ? "error" : "ready", error });
    await configureChannelAccount({ storeId: store.id, actorUserId: ctx.user.id, channel: "instagram", providerAccountId: instagram.externalId, providerDisplayName: instagram.displayName, connectionStatus: "testing" });
    if (!failures.length) await ensureMetaHistorySyncJobs(store.id, ctx.user.id);
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "channel_account", entityId: `instagram:${instagram.externalId}`, action: "meta.instagram_reception_repaired", summary: error || "تم التحقق من ربط صفحة Instagram المرتبطة. تبقى حقول Webhook مضبوطة من لوحة Meta ثم يؤكدها وصول أول رسالة." });
    if (failures.length) throw new TRPCError({ code: "BAD_GATEWAY", message: error || "تعذر إصلاح استقبال Instagram." });
    return { dashboardSetupRequired: true, assetReady: !failures.length };
  }),
  setAssetSelection: protectedProcedure.input(z.object({ connectionId: z.number().int().positive(), assetId: z.number().int().positive(), selected: z.boolean() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const asset = await setMetaAssetSelection({ storeId: store.id, ...input });
    const subscriptionWarnings = input.selected && asset.assetType === "page" ? await ensureSelectedMessengerPageSubscriptions(store.id, input.connectionId) : input.selected && asset.assetType === "instagram" ? await ensureSelectedInstagramSubscriptions(store.id, input.connectionId) : input.selected && ["whatsapp_business", "whatsapp_phone"].includes(asset.assetType) ? await ensureSelectedWhatsAppSubscriptions(store.id, input.connectionId) : [];
    const channel = asset.connectionPurpose === "unified" || asset.connectionPurpose === "messaging" ? (asset.assetType === "whatsapp_phone" ? "whatsapp" : asset.assetType === "instagram" ? "instagram" : asset.assetType === "page" ? "messenger" : null) : null;
    if (channel) {
      await configureChannelAccount({
        storeId: store.id,
        actorUserId: ctx.user.id,
        channel,
        providerAccountId: asset.externalId,
        providerDisplayName: asset.displayName,
        connectionStatus: input.selected ? (["messenger", "instagram"].includes(channel) && !subscriptionWarnings.length ? "connected" : "testing") : "disabled",
      });
      if (input.selected && ["messenger", "instagram"].includes(channel)) await ensureMetaHistorySyncJobs(store.id, ctx.user.id);
    }
    await syncMetaConnectionCapabilities({ storeId: store.id, connectionId: input.connectionId, grantedScopes: asset.grantedScopes.split(",").filter(Boolean) });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_asset", entityId: asset.id, action: input.selected ? "meta.asset_enabled" : "meta.asset_disabled", summary: `${input.selected ? "تم تفعيل" : "تم استبعاد"} أصل Meta من نوع ${asset.assetType} داخل المتجر.` });
    return { ...asset, channel, subscriptionWarnings };
  }),
  setAssetSelections: protectedProcedure.input(z.object({ connectionId: z.number().int().positive(), assetIds: z.array(z.number().int().positive()).min(1).max(100), selected: z.boolean() })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const uniqueAssetIds = Array.from(new Set(input.assetIds));
    let grantedScopes = "";
    const updatedAssets = [] as Awaited<ReturnType<typeof setMetaAssetSelection>>[];
    for (const assetId of uniqueAssetIds) {
      const asset = await setMetaAssetSelection({ storeId: store.id, connectionId: input.connectionId, assetId, selected: input.selected });
      updatedAssets.push(asset);
      grantedScopes = asset.grantedScopes;
    }
    const latest = await listMetaConnectionOverview(store.id);
    const selected = latest.assets.filter(asset => asset.connectionId === input.connectionId && asset.isSelected);
    const messengerWarnings = await ensureSelectedMessengerPageSubscriptions(store.id, input.connectionId);
    const instagramWarnings = await ensureSelectedInstagramSubscriptions(store.id, input.connectionId);
    const whatsappWarnings = await ensureSelectedWhatsAppSubscriptions(store.id, input.connectionId);
    const subscriptionWarnings = [...messengerWarnings, ...instagramWarnings, ...whatsappWarnings];
    const channelWarningsByType = { messenger: messengerWarnings, instagram: instagramWarnings, whatsapp: whatsappWarnings } as const;
    for (const asset of updatedAssets) {
      const channel = asset.assetType === "whatsapp_phone" ? "whatsapp" : asset.assetType === "instagram" ? "instagram" : asset.assetType === "page" ? "messenger" : null;
      if (!channel) continue;
      const channelWarnings = channelWarningsByType[channel];
      await configureChannelAccount({
        storeId: store.id,
        actorUserId: ctx.user.id,
        channel,
        providerAccountId: asset.externalId,
        providerDisplayName: asset.displayName,
        connectionStatus: input.selected ? (["messenger", "instagram"].includes(channel) && !channelWarnings.length ? "connected" : "testing") : "disabled",
      });
    }
    if (input.selected && selected.some(asset => ["page", "instagram"].includes(asset.assetType))) await ensureMetaHistorySyncJobs(store.id, ctx.user.id);
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
  startHistorySync: protectedProcedure.mutation(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const jobs = await ensureMetaHistorySyncJobs(store.id, ctx.user.id);
    const first = jobs.find(job => ["pending", "retry_pending"].includes(job.status));
    const firstBatch = first ? await processMetaHistorySyncJob(first.id) : null;
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_history_sync", entityId: store.id, action: "meta.history_sync_started", summary: "بدأت مزامنة سجل الرسائل المتاح رسمياً للقنوات المختارة دون تشغيل البوت أو إشعارات الرسائل القديمة." });
    return { jobs: await listMetaHistorySyncJobs(store.id), firstBatch };
  }),
  historyProgress: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
    await assertPermission(ctx.user, "inbox.read", ctx.operationalStore.id);
    const [jobs, whatsappOnboardings] = await Promise.all([listMetaHistorySyncJobs(ctx.operationalStore.id), listWhatsAppOnboardings(ctx.operationalStore.id)]);
    return {
      jobs: jobs.map(job => ({ id: job.id, channel: job.channel, status: job.status, stage: job.stage, processedConversations: job.processedConversations, processedMessages: job.processedMessages, duplicateMessages: job.duplicateMessages, oldestMessageAt: job.oldestMessageAt, newestMessageAt: job.newestMessageAt, lastRunAt: job.lastRunAt, completedAt: job.completedAt, lastError: job.lastError })),
      whatsapp: whatsappOnboardings.map(item => ({ phoneNumberId: item.phoneNumberId, coexistenceMode: item.coexistenceMode, onboardingStatus: item.onboardingStatus, historyProgress: item.historyProgress, oldestMessageAt: item.oldestMessageAt, newestMessageAt: item.newestMessageAt })),
    };
  }),
  controlHistorySync: protectedProcedure.input(z.object({ jobId: z.number().int().positive(), action: z.enum(["pause", "resume", "retry"]) })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const result = await setMetaHistorySyncStatus(store.id, input.jobId, input.action);
    if (input.action !== "pause") await processMetaHistorySyncJob(input.jobId);
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_history_sync", entityId: input.jobId, action: `meta.history_sync_${input.action}`, summary: `${input.action === "pause" ? "أوقف" : input.action === "resume" ? "استأنف" : "أعاد"} المستخدم مزامنة سجل Meta لهذه القناة.` });
    return { result, jobs: await listMetaHistorySyncJobs(store.id) };
  }),
  runHistorySyncBatch: protectedProcedure.mutation(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const [result, whatsappHistory] = await Promise.all([processDueMetaHistorySyncJobs(3), processDueWhatsAppHistoryChunks(2)]);
    return { ...result, whatsappHistory, jobs: await listMetaHistorySyncJobs(store.id) };
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
    if (!runtime.appId || !runtime.appSecret || !runtime.publicBaseUrl) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "أكمل إعداد تطبيق Meta المركزي ورابط العودة قبل بدء التفويض." });
    const state = randomBytes(32).toString("base64url");
    await createMetaOAuthState({ state, storeId: store.id, userId: ctx.user.id, purpose: input.purpose, authMode: "external_business", templateVersion: runtime.activeTemplateVersion, requestedScopes: metaScopesByPurpose[input.purpose], expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
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
