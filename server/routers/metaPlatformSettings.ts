import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { recordAuditEvent } from "../audit/db";
import {
  allowedMetaGraphVersions,
  defaultMetaCapabilities,
  getMaskedMetaPlatformSettings,
  recordMetaPlatformWebhookReadiness,
  rotateMetaWebhookVerifyToken,
  saveMetaPlatformSettings,
  testMetaPlatformSettings,
} from "../integrations/meta/platformSettings";
import { ensureMetaPlatformWebhookSubscriptions } from "../integrations/meta/oauth";

function requirePlatformAdmin(ctx: { user: { role: string }; operationalStore: { id: number } | null }) {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "إعداد تطبيق Meta متاح لمدير المنصة فقط." });
  return ctx.operationalStore;
}

const settingsInput = z.object({
  appId: z.string().trim().regex(/^\d{5,80}$/, "معرّف تطبيق Meta يجب أن يتكون من أرقام فقط."),
  appSecret: z.string().trim().max(500).optional(),
  businessLoginConfigurationId: z.string().trim().max(255),
  whatsappEmbeddedSignupConfigurationId: z.string().trim().max(255).optional(),
  graphApiVersion: z.enum(allowedMetaGraphVersions),
  publicBaseUrl: z.string().trim().url("أدخل نطاقاً عاماً صالحاً.").max(512),
  defaultCapabilities: z.array(z.enum(defaultMetaCapabilities)).min(1).optional(),
});

export const metaPlatformSettingsRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    requirePlatformAdmin(ctx);
    const settings = await getMaskedMetaPlatformSettings();
    return {
      settings,
      allowedGraphVersions: allowedMetaGraphVersions,
      allowedCapabilities: defaultMetaCapabilities,
      oauthCallbackUrl: settings.oauthCallbackUrl,
      webhookCallbackUrl: settings.webhookCallbackUrl,
    };
  }),
  save: protectedProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
    const store = requirePlatformAdmin(ctx);
    try {
      const result = await saveMetaPlatformSettings({ ...input, actorUserId: ctx.user.id });
      if (store) await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_platform_settings", entityId: "1", action: "meta.platform_settings_saved", summary: "تم تحديث إعداد تطبيق Meta المركزي من داخل المنصة دون تسجيل القيم السرية." });
      return result;
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذر حفظ إعداد Meta." });
    }
  }),
  test: protectedProcedure.mutation(async ({ ctx }) => {
    const store = requirePlatformAdmin(ctx);
    try {
      await testMetaPlatformSettings();
      const webhookSubscriptions = await ensureMetaPlatformWebhookSubscriptions();
      const readiness = await recordMetaPlatformWebhookReadiness(webhookSubscriptions);
      const settings = await getMaskedMetaPlatformSettings();
      if (store) await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_platform_settings", entityId: "1", action: "meta.platform_settings_verified", summary: "تم التحقق من إعداد تطبيق Meta المركزي بنجاح." });
      return { settings, webhookSubscriptions, ready: readiness.ready };
    } catch (error) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: error instanceof Error ? error.message : "تعذر اختبار إعداد Meta." });
    }
  }),
  rotateWebhookVerifyToken: protectedProcedure.input(z.object({ confirm: z.literal(true) })).mutation(async ({ ctx }) => {
    const store = requirePlatformAdmin(ctx);
    const webhookVerifyToken = await rotateMetaWebhookVerifyToken(ctx.user.id);
    if (store) await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "meta_platform_settings", entityId: "1", action: "meta.webhook_verify_token_rotated", summary: "تم تدوير رمز تحقق Meta Webhook وعرض القيمة الجديدة مرة واحدة." });
    return { webhookVerifyToken };
  }),
});
