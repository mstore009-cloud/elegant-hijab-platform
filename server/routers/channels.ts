import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import { configureChannelAccount, externalChannels, listChannelAccounts } from "../channels/db";
import { listMetaConnectionOverview } from "../integrations/meta/db";
import { getMetaRuntimeSettings } from "../integrations/meta/platformSettings";

async function requireStore(ctx: { user: NonNullable<any>; operationalStore: { id: number } | null }) {
  if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
  await assertPermission(ctx.user, "bot.manage", ctx.operationalStore.id);
  return ctx.operationalStore;
}

function getPublicWebhookUrl(req: { protocol?: string; get?: (name: string) => string | undefined }) {
  const forwardedProtocol = req.get?.("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = req.get?.("x-forwarded-host") ?? req.get?.("host");
  if (!host) return "/api/webhooks/meta";
  return `${forwardedProtocol || req.protocol || "https"}://${host}/api/webhooks/meta`;
}

const accountInput = z.object({
  channel: z.enum(externalChannels),
  providerAccountId: z.string().trim().max(255).nullable().optional(),
  providerDisplayName: z.string().trim().max(160).nullable().optional(),
  connectionStatus: z.enum(["disconnected", "testing", "connected", "disabled"]),
});

export const channelsRouter = router({
  accounts: protectedProcedure.query(async ({ ctx }) => {
    const store = await requireStore(ctx);
    const [runtime, metaOverview] = await Promise.all([getMetaRuntimeSettings(), listMetaConnectionOverview(store.id)]);
    const unifiedConnection = metaOverview.connections.find(connection => connection.purpose === "unified");
    const delegatedConnection = unifiedConnection ? (unifiedConnection.status === "connected" ? unifiedConnection : null) : metaOverview.connections.find(connection => connection.purpose === "messaging" && connection.status === "connected");
    return {
      accounts: await listChannelAccounts(store.id),
      webhookUrl: getPublicWebhookUrl(ctx.req),
      credentialsConfigured: Boolean(runtime.appSecret && runtime.webhookVerifyToken && delegatedConnection),
      externalSendingEnabled: false,
    };
  }),
  configureAccount: protectedProcedure.input(accountInput).mutation(async ({ ctx, input }) => {
    const store = await requireStore(ctx);
    const providerAccountId = input.providerAccountId?.trim() || null;
    if (["testing", "connected"].includes(input.connectionStatus) && !providerAccountId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "أدخل معرّف حساب القناة قبل وضعه في حالة اختبار أو اتصال." });
    }
    const [runtime, metaOverview] = await Promise.all([getMetaRuntimeSettings(), listMetaConnectionOverview(store.id)]);
    const unifiedConnection = metaOverview.connections.find(connection => connection.purpose === "unified");
    const delegatedConnection = unifiedConnection ? (unifiedConnection.status === "connected" ? unifiedConnection : null) : metaOverview.connections.find(connection => connection.purpose === "messaging" && connection.status === "connected");
    if (input.connectionStatus === "connected" && !(runtime.appSecret && runtime.webhookVerifyToken && delegatedConnection)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إعلان اتصال حي قبل إضافة أسرار Meta والتحقق من webhook. استخدم «اختبار» حتى ذلك الحين." });
    }
    const account = await configureChannelAccount({ ...input, providerAccountId, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({
      storeId: store.id,
      actorUserId: ctx.user.id,
      entityType: "channel_account",
      entityId: account.id,
      action: "channel.account_configured",
      summary: `تم تحديث حالة قناة ${input.channel === "whatsapp" ? "واتساب" : input.channel === "instagram" ? "إنستغرام" : "Messenger"} إلى ${input.connectionStatus}.`,
    });
    return account;
  }),
});
