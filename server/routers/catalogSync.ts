import { TRPCError } from "@trpc/server";
import { parse as parseCookie } from "cookie";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { assertPermission } from "../access/authorization";
import { createHeartbeatJob, updateHeartbeatJob } from "../_core/heartbeat";
import { protectedProcedure, router } from "../_core/trpc";
import { listDeletedCatalogProducts, restoreDeletedCatalogProduct, scanCatalogForOwner } from "../products/catalogAutomation";
import { getOrCreateCatalogSyncSettings, markCatalogSyncCompleted, markCatalogSyncFailed, markCatalogSyncStarted, persistCatalogSyncTask } from "../products/catalogSyncSettings";

const cronSchema = z.string().trim().regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, "اكتب التكرار بصيغة ستة أجزاء (ثانية، دقيقة، ساعة، يوم، شهر، أسبوع). ");

function requireOperationalStoreId(storeId: number | null | undefined) {
  if (!storeId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لا يوجد متجر تشغيلي نشط لحسابك." });
  return storeId;
}

async function runAndRecord(input: { ownerUserId: number; storeId: number }) {
  const setting = await getOrCreateCatalogSyncSettings(input);
  await markCatalogSyncStarted(setting.id);
  try {
    const summary = await scanCatalogForOwner(input);
    await markCatalogSyncCompleted({ settingId: setting.id, summary });
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر فحص Catalog.";
    await markCatalogSyncFailed({ settingId: setting.id, error: message });
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
  }
}

export const catalogSyncRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    return getOrCreateCatalogSyncSettings({ ownerUserId: ctx.user.id, storeId: requireOperationalStoreId(ctx.operationalStore?.id) });
  }),
  runNow: protectedProcedure.mutation(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    return runAndRecord({ ownerUserId: ctx.user.id, storeId: requireOperationalStoreId(ctx.operationalStore?.id) });
  }),
  deletedProducts: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    return listDeletedCatalogProducts({ ownerUserId: ctx.user.id, storeId: requireOperationalStoreId(ctx.operationalStore?.id) });
  }),
  restoreDeletedProduct: protectedProcedure.input(z.object({ productFolderId: z.string().trim().min(1).max(255) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    try {
      return await restoreDeletedCatalogProduct({ ownerUserId: ctx.user.id, storeId: requireOperationalStoreId(ctx.operationalStore?.id), productFolderId: input.productFolderId });
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذرت استعادة المنتج من Catalog." });
    }
  }),
  activate: protectedProcedure.input(z.object({ cronExpression: cronSchema.default("0 */10 * * * *") })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const setting = await getOrCreateCatalogSyncSettings({ ownerUserId: ctx.user.id, storeId: requireOperationalStoreId(ctx.operationalStore?.id) });
    const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
    if (!sessionToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "تحتاج إلى جلسة دخول صالحة لتفعيل الفحص الدوري." });
    if (setting.scheduleCronTaskUid) {
      const updated = await updateHeartbeatJob(setting.scheduleCronTaskUid, { cron: input.cronExpression, path: "/api/scheduled/catalog-scan", method: "POST", enable: true }, sessionToken);
      return { taskUid: setting.scheduleCronTaskUid, nextExecutionAt: updated.nextExecutionAt ?? null, updated: true as const };
    }
    const created = await createHeartbeatJob({
      name: `catalog-scan-${ctx.user.id}`,
      cron: input.cronExpression,
      path: "/api/scheduled/catalog-scan",
      method: "POST",
      description: "فحص Catalog دوريًا وإنشاء مسودات المنتجات الناقصة.",
    }, sessionToken);
    await persistCatalogSyncTask({ settingId: setting.id, taskUid: created.taskUid });
    return { taskUid: created.taskUid, nextExecutionAt: created.nextExecutionAt ?? null, updated: false as const };
  }),
});
