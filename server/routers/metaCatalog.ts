import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { assertPermission } from "../access/authorization";
import { protectedProcedure, router } from "../_core/trpc";
import { listMetaConnectionOverview } from "../integrations/meta/db";
import { buildMetaCatalogExportSnapshot, listMetaCatalogExportJobs, previewMetaCatalogExport, runMetaCatalogExport } from "../integrations/meta/catalogExportDb";
import { getMetaCatalogEnrichmentSettings, getMetaCatalogProductEnrichment, META_CATALOG_AGE_GROUPS, META_CATALOG_AVAILABILITY, META_CATALOG_CONDITIONS, META_CATALOG_GENDERS, META_CATALOG_MEDIA_POLICIES, saveMetaCatalogEnrichmentSettings, saveMetaCatalogProductEnrichment } from "../integrations/meta/catalogEnrichment";
import { prepareMetaCatalogMediaForProduct, prepareMetaCatalogMediaForStore } from "../integrations/meta/catalogMediaPreparation";

function requireOperationalStoreId(storeId: number | null | undefined) {
  if (!storeId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "لا يوجد متجر تشغيلي نشط لحسابك." });
  return storeId;
}

const catalogAssetInput = z.object({ catalogAssetId: z.number().int().positive() });
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const settingsInput = z.object({
  brand: optionalText(100),
  currency: z.string().trim().length(3).optional(),
  condition: z.enum(META_CATALOG_CONDITIONS).optional(),
  defaultFbProductCategory: optionalText(500),
  defaultGoogleProductCategory: optionalText(250),
  defaultGender: z.enum(META_CATALOG_GENDERS).nullable().optional(),
  defaultAgeGroup: z.enum(META_CATALOG_AGE_GROUPS).nullable().optional(),
  productLinkBaseUrl: optionalText(2048),
  defaultProductType: optionalText(750),
  defaultAvailability: z.enum(META_CATALOG_AVAILABILITY).optional(),
  mediaPolicy: z.enum(META_CATALOG_MEDIA_POLICIES).optional(),
});
const productEnrichmentInput = z.object({
  productId: z.number().int().positive(),
  fbProductCategory: optionalText(500),
  googleProductCategory: optionalText(250),
  material: optionalText(200),
  pattern: optionalText(100),
  gender: z.enum(META_CATALOG_GENDERS).nullable().optional(),
  ageGroup: z.enum(META_CATALOG_AGE_GROUPS).nullable().optional(),
  productType: optionalText(750),
  productLink: optionalText(2048),
  exportEnabled: z.boolean().optional(),
});

export const metaCatalogRouter = router({
  settings: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "products.create");
    return getMetaCatalogEnrichmentSettings(requireOperationalStoreId(ctx.operationalStore?.id));
  }),
  saveSettings: protectedProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    try {
      return await saveMetaCatalogEnrichmentSettings({ ...input, storeId: requireOperationalStoreId(ctx.operationalStore?.id), actorUserId: ctx.user.id });
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذر حفظ إعدادات إثراء Meta Catalog." });
    }
  }),
  productEnrichment: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.create");
    try {
      return await getMetaCatalogProductEnrichment({ storeId: requireOperationalStoreId(ctx.operationalStore?.id), productId: input.productId });
    } catch (error) {
      throw new TRPCError({ code: "NOT_FOUND", message: error instanceof Error ? error.message : "تعذر قراءة إثراء المنتج." });
    }
  }),
  saveProductEnrichment: protectedProcedure.input(productEnrichmentInput).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    const { productId, ...values } = input;
    try {
      return await saveMetaCatalogProductEnrichment({ ...values, storeId: requireOperationalStoreId(ctx.operationalStore?.id), productId, actorUserId: ctx.user.id });
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذر حفظ حقول Meta Catalog الخاصة بالمنتج." });
    }
  }),
  prepareProductMedia: protectedProcedure.input(z.object({ productId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    try {
      return await prepareMetaCatalogMediaForProduct({ storeId: requireOperationalStoreId(ctx.operationalStore?.id), productId: input.productId, actorUserId: ctx.user.id });
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذر تجهيز وسائط Meta Catalog." });
    }
  }),
  prepareProductsMedia: protectedProcedure.input(z.object({ productIds: z.array(z.number().int().positive()).min(1).max(250) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "products.edit");
    try {
      return await prepareMetaCatalogMediaForStore({ storeId: requireOperationalStoreId(ctx.operationalStore?.id), productIds: input.productIds, actorUserId: ctx.user.id });
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذر تجهيز وسائط المنتجات لكتالوج Meta." });
    }
  }),
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
