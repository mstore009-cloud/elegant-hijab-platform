import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import { configureChannelAccount } from "../channels/db";
import { getMetaEventHealth, getMetaRetryStatus, requeueMetaDeadLetters, retryDueMetaEvents } from "../channels/metaEvents";
import { createMetaOAuthState, disconnectMetaConnection, getMetaConnection, listMetaConnectionOverview, markMetaConnectionVerified, metaPurposes, selectMetaAsset, upsertDiscoveredMetaAssets } from "../integrations/meta/db";
import { decryptMetaToken, metaConnectionTokenContext } from "../integrations/meta/tokenCipher";
import { createMetaAuthorizationUrl, discoverMetaAssets, metaConfigurationId, metaScopesByPurpose } from "../integrations/meta/oauth";

const purposeSchema = z.enum(metaPurposes);

async function requireStore(ctx: { user: NonNullable<any>; operationalStore: { id: number } | null }) {
  if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
  await assertPermission(ctx.user, "settings.manage", ctx.operationalStore.id);
  return ctx.operationalStore;
}

function configured() {
  return Boolean(ENV.metaAppId && ENV.metaAppSecret && ENV.metaRedirectUri);
}

export const metaConnectionsRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const [connectionOverview, eventHealth, retryStatus] = await Promise.all([listMetaConnectionOverview(store.id), getMetaEventHealth(store.id), getMetaRetryStatus()]);
    return {
      ...connectionOverview,
      eventHealth,
      retryStatus,
      configured: configured(),
      callbackUrl: ENV.metaRedirectUri || "/api/meta/oauth/callback",
      graphVersion: ENV.metaGraphApiVersion,
      purposes: metaPurposes.map(purpose => ({ purpose, scopes: metaScopesByPurpose[purpose], configurationIdConfigured: Boolean(metaConfigurationId(purpose)) })),
    };
  }),
  beginAuthorization: protectedProcedure.input(z.object({ purpose: purposeSchema })).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    if (!configured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "أكمل App ID وApp Secret وRedirect URI لتطبيق Meta قبل بدء التفويض." });
    const state = randomBytes(32).toString("base64url");
    await createMetaOAuthState({ state, storeId: store.id, userId: ctx.user.id, purpose: input.purpose, requestedScopes: metaScopesByPurpose[input.purpose], expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    return { authorizationUrl: createMetaAuthorizationUrl({ state, purpose: input.purpose }) };
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
