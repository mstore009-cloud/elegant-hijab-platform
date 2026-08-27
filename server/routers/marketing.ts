import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import {
  archiveMarketingCampaign,
  createMarketingCampaign,
  getMarketingCampaign,
  listApprovedContentPosts,
  listMarketingCampaigns,
  listStoreTags,
  removeMarketingBudgetItem,
  replaceCampaignContent,
  requestCampaignApproval,
  reviewMarketingCampaign,
  saveMarketingBudgetItem,
  updateMarketingCampaign,
} from "../marketing/db";
import { protectedProcedure, router } from "../_core/trpc";

const statusSchema = z.enum(["draft", "needs_approval", "approved", "changes_requested", "archived"]);
const objectiveSchema = z.enum(["product_launch", "reengagement", "promotion", "awareness", "other"]);
const audienceTypeSchema = z.enum(["all_customers", "customer_tag", "relationship_stage"]);
const relationshipStageSchema = z.enum(["new", "active", "repeat", "needs_followup", "inactive"]);
const fieldsSchema = z.object({
  name: z.string().min(1).max(180).optional(),
  objective: objectiveSchema.optional(),
  description: z.string().max(4000).nullable().optional(),
  audienceType: audienceTypeSchema.optional(),
  audienceTagId: z.number().int().positive().nullable().optional(),
  audienceStage: relationshipStageSchema.nullable().optional(),
  budgetAmount: z.number().min(0).max(999_999_999).optional(),
  budgetCurrency: z.string().min(3).max(12).optional(),
});

function storeId(store: { id: number } | null | undefined) {
  if (!store) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للمستخدم." });
  return store.id;
}

function toTrpcError(error: unknown) {
  return new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذر تنفيذ العملية." });
}

export const marketingRouter = router({
  list: protectedProcedure.input(z.object({ status: statusSchema.optional() }).optional()).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.view");
    return listMarketingCampaigns({ storeId: storeId(ctx.operationalStore), ...input });
  }),
  byId: protectedProcedure.input(z.object({ campaignId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.view");
    const campaign = await getMarketingCampaign(input.campaignId, storeId(ctx.operationalStore));
    if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "الحملة غير موجودة." });
    return campaign;
  }),
  approvedContent: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "marketing.view");
    return listApprovedContentPosts(storeId(ctx.operationalStore));
  }),
  tags: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "marketing.view");
    return listStoreTags(storeId(ctx.operationalStore));
  }),
  create: protectedProcedure.input(fieldsSchema.extend({ name: z.string().min(1).max(180), objective: objectiveSchema })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const campaignId = await createMarketingCampaign({ ...input, storeId: activeStoreId, createdByUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "marketing_campaign", entityId: campaignId, action: "created", summary: "أنشأ حملة تسويق داخلية." });
      return { campaignId, status: "draft" as const };
    } catch (error) { throw toTrpcError(error); }
  }),
  update: protectedProcedure.input(fieldsSchema.extend({ campaignId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const { campaignId, ...fields } = input;
      const campaign = await updateMarketingCampaign({ ...fields, campaignId, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "marketing_campaign", entityId: campaignId, action: "updated", summary: "عدّل حملة تسويق داخلية." });
      return campaign;
    } catch (error) { throw toTrpcError(error); }
  }),
  setContent: protectedProcedure.input(z.object({ campaignId: z.number().int().positive(), contentPostIds: z.array(z.number().int().positive()).max(50) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try { return await replaceCampaignContent({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id }); } catch (error) { throw toTrpcError(error); }
  }),
  saveBudgetItem: protectedProcedure.input(z.object({ campaignId: z.number().int().positive(), budgetItemId: z.number().int().positive().optional(), name: z.string().min(1).max(180), description: z.string().max(2000).nullable().optional(), unitPrice: z.number().min(0).max(999_999_999), quantity: z.number().int().min(1).max(100000) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try { return await saveMarketingBudgetItem({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id }); } catch (error) { throw toTrpcError(error); }
  }),
  removeBudgetItem: protectedProcedure.input(z.object({ campaignId: z.number().int().positive(), budgetItemId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try { return await removeMarketingBudgetItem({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id }); } catch (error) { throw toTrpcError(error); }
  }),
  requestApproval: protectedProcedure.input(z.object({ campaignId: z.number().int().positive(), note: z.string().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const result = await requestCampaignApproval({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "marketing_campaign", entityId: input.campaignId, action: "approval_requested", summary: "طلب اعتماد حملة تسويق داخلية." });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
  review: protectedProcedure.input(z.object({ campaignId: z.number().int().positive(), decision: z.enum(["approved", "changes_requested"]), note: z.string().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.approve");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const result = await reviewMarketingCampaign({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "marketing_campaign", entityId: input.campaignId, action: input.decision, summary: input.decision === "approved" ? "اعتمد حملة تسويق داخلياً." : "طلب تعديل حملة تسويق." });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
  archive: protectedProcedure.input(z.object({ campaignId: z.number().int().positive(), note: z.string().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const result = await archiveMarketingCampaign({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "marketing_campaign", entityId: input.campaignId, action: "archived", summary: "أرشف حملة تسويق داخلية." });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
});
