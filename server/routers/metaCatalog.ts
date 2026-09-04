import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { assertPermission } from "../access/authorization";
import { protectedProcedure, router } from "../_core/trpc";
import { listMetaConnectionOverview } from "../integrations/meta/db";
import { buildMetaCatalogExportSnapshot, listMetaCatalogExportJobs, previewMetaCatalogExport, runMetaCatalogExport } from "../integrations/meta/catalogExportDb";

function requireOperationalStoreId(storeId: number | null | undefined) {
  if (!storeId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لا يوجد متجر تشغيلي نشط لحسابك." });
  return storeId;
}

const catalogAssetInput = z.object({ catalogAssetId: z.number().int().positive() });

export const metaCatalogRouter = router({
  preview: protectedProcedure.input(catalogAssetInput).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    return previewMetaCatalogExport({ storeId, catalogAssetId: input.catalogAssetId });
  }),
  exportNow: protectedProcedure.input(catalogAssetInput).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    try {
      return await runMetaCatalogExport({ storeId, catalogAssetId: input.catalogAssetId, createdByUserId: ctx.user.id });
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذر تصدير Catalog إلى Meta." });
    }
  }),
  jobs: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    return listMetaCatalogExportJobs({ storeId: requireOperationalStoreId(ctx.operationalStore?.id) });
  }),
  readiness: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    const storeId = requireOperationalStoreId(ctx.operationalStore?.id);
    const overview = await listMetaConnectionOverview(storeId);
    const catalogCapability = overview.capabilities.find(capability => capability.purpose === "catalog");
    const catalogAssets = overview.assets.filter(asset => asset.assetType === "catalog");
    return { capability: catalogCapability ?? null, assets: catalogAssets.map(asset => ({ id: asset.id, externalId: asset.externalId, displayName: asset.displayName, isSelected: asset.isSelected })) };
  }),
});
