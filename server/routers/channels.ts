import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { assertPermission } from "../access/authorization";
import { deriveAllChannelHealth } from "../channels/health";
import { externalChannels, listChannelAccounts } from "../channels/db";
import { listMetaConnectionOverview } from "../integrations/meta/db";
import { getMetaRuntimeSettings } from "../integrations/meta/platformSettings";

async function requireStore(ctx: { user: NonNullable<any>; operationalStore: { id: number } | null }) {
  if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
  await assertPermission(ctx.user, "bot.manage", ctx.operationalStore.id);
  return ctx.operationalStore;
}

export const channelsRouter = router({
  /**
   * The Bot Center is read-only for channel identity. Meta Connections owns
   * asset selection and subscription repair; this endpoint only projects the
   * resulting, store-scoped runtime health.
   */
  accounts: protectedProcedure.query(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const [runtime, metaOverview, accounts] = await Promise.all([
      getMetaRuntimeSettings(),
      listMetaConnectionOverview(store.id),
      listChannelAccounts(store.id),
    ]);
    const unifiedConnection = metaOverview.connections.find(connection => connection.purpose === "unified") ?? null;
    const channels = deriveAllChannelHealth({
      accounts,
      connections: metaOverview.connections,
      assets: metaOverview.assets,
      capabilities: metaOverview.capabilities,
    });
    const messagingCapability = unifiedConnection
      ? metaOverview.capabilities.find(capability => capability.connectionId === unifiedConnection.id && capability.purpose === "messaging") ?? null
      : null;
    const selectedMessagingAssets = unifiedConnection
      ? metaOverview.assets.filter(asset => asset.connectionId === unifiedConnection.id && asset.isSelected && ["page", "instagram", "whatsapp_phone"].includes(asset.assetType)).length
      : 0;
    const credentialsConfigured = Boolean(runtime.appSecret && runtime.webhookVerifyToken && unifiedConnection?.status === "connected");
    return {
      channels,
      meta: {
        unifiedStatus: unifiedConnection?.status ?? "not_connected",
        unifiedConnectionId: unifiedConnection?.id ?? null,
        selectedMessagingAssets,
        messagingCapabilityStatus: messagingCapability?.status ?? "needs_setup",
        messagingCapabilityEnabled: Boolean(messagingCapability?.enabled),
        lastVerifiedAt: unifiedConnection?.lastVerifiedAt ?? null,
        lastError: unifiedConnection?.lastError ?? null,
      },
      credentialsConfigured,
      externalSendingEnabled: channels.some(channel => channel.sendReady),
      availableChannelTypes: externalChannels,
    };
  }),
});
