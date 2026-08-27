import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import {
  archiveLoyaltyReward,
  createLoyaltyMembership,
  createLoyaltyProgram,
  createLoyaltyReward,
  getLoyaltyMembershipDetail,
  getLoyaltyOverview,
  listLoyaltyCustomers,
  loyaltyLedgerReasons,
  loyaltyMembershipStatuses,
  loyaltyProgramStatuses,
  recordLoyaltyPoints,
  requestLoyaltyRewardApproval,
  reviewLoyaltyReward,
  saveLoyaltyTier,
  setLoyaltyProgramStatus,
  updateLoyaltyMembership,
  updateLoyaltyProgram,
} from "../loyalty/db";
import { protectedProcedure, router } from "../_core/trpc";

function storeId(store: { id: number } | null | undefined) {
  if (!store) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للمستخدم." });
  return store.id;
}

function toTrpcError(error: unknown) {
  return new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "تعذر تنفيذ العملية." });
}

const nullableText = z.string().max(4000).nullable().optional();

export const loyaltyRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "loyalty.view");
    return getLoyaltyOverview(storeId(ctx.operationalStore));
  }),
  customers: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "loyalty.view");
    return listLoyaltyCustomers(storeId(ctx.operationalStore));
  }),
  membership: protectedProcedure.input(z.object({ membershipId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "loyalty.view");
    try { return await getLoyaltyMembershipDetail({ storeId: storeId(ctx.operationalStore), membershipId: input.membershipId }); } catch (error) { throw toTrpcError(error); }
  }),
  createProgram: protectedProcedure.input(z.object({ name: z.string().min(1).max(180), pointsLabel: z.string().min(1).max(80).optional(), description: nullableText })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "loyalty.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const result = await createLoyaltyProgram({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "loyalty_program", entityId: result.program.id, action: "created", summary: "أنشأ برنامج ولاء داخلياً." });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
  updateProgram: protectedProcedure.input(z.object({ programId: z.number().int().positive(), name: z.string().min(1).max(180).optional(), pointsLabel: z.string().min(1).max(80).optional(), description: nullableText })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "loyalty.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const { programId, ...fields } = input;
      const result = await updateLoyaltyProgram({ ...fields, programId, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "loyalty_program", entityId: programId, action: "updated", summary: "عدّل إعدادات برنامج الولاء." });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
  setProgramStatus: protectedProcedure.input(z.object({ programId: z.number().int().positive(), status: z.enum(loyaltyProgramStatuses).exclude(["draft"]), note: z.string().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "loyalty.approve");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const result = await setLoyaltyProgramStatus({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "loyalty_program", entityId: input.programId, action: `status_${input.status}`, summary: `حدّث حالة برنامج الولاء إلى ${input.status}.` });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
  saveTier: protectedProcedure.input(z.object({ programId: z.number().int().positive(), tierId: z.number().int().positive().optional(), name: z.string().min(1).max(120), rank: z.number().int().min(0).max(99), thresholdPoints: z.number().int().min(0).max(1_000_000).optional(), benefitsSummary: nullableText, isBase: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "loyalty.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const result = await saveLoyaltyTier({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "loyalty_tier", entityId: input.tierId ?? input.programId, action: input.tierId ? "updated" : "created", summary: input.tierId ? "عدّل مستوى ولاء يدوياً." : "أنشأ مستوى ولاء يدوياً." });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
  createMembership: protectedProcedure.input(z.object({ programId: z.number().int().positive(), customerId: z.number().int().positive(), tierId: z.number().int().positive().nullable().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "loyalty.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const result = await createLoyaltyMembership({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "loyalty_membership", entityId: result.membership.id, action: "joined", summary: "أضاف عميلاً إلى برنامج الولاء." });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
  updateMembership: protectedProcedure.input(z.object({ membershipId: z.number().int().positive(), status: z.enum(loyaltyMembershipStatuses).optional(), tierId: z.number().int().positive().nullable().optional(), note: z.string().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "loyalty.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const result = await updateLoyaltyMembership({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "loyalty_membership", entityId: input.membershipId, action: "updated", summary: "حدّث عضوية أو مستوى ولاء يدوياً." });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
  recordPoints: protectedProcedure.input(z.object({ membershipId: z.number().int().positive(), direction: z.enum(["credit", "debit"]), points: z.number().int().min(1).max(1_000_000), reason: z.enum(loyaltyLedgerReasons), note: z.string().min(1).max(4000) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "loyalty.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const result = await recordLoyaltyPoints({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "loyalty_ledger", entityId: result.ledgerEntryId, action: "points_recorded", summary: "سجل حركة نقاط يدوية غير مالية.", metadata: { membershipId: input.membershipId, direction: input.direction, points: input.points, reason: input.reason } });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
  createReward: protectedProcedure.input(z.object({ programId: z.number().int().positive(), membershipId: z.number().int().positive(), title: z.string().min(1).max(180), description: nullableText })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "loyalty.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const result = await createLoyaltyReward({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "loyalty_reward", entityId: result.rewardId, action: "created", summary: "أنشأ مكافأة ولاء داخلية كمسودة." });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
  requestRewardApproval: protectedProcedure.input(z.object({ rewardId: z.number().int().positive(), note: z.string().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "loyalty.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const result = await requestLoyaltyRewardApproval({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "loyalty_reward", entityId: input.rewardId, action: "approval_requested", summary: "طلب اعتماد مكافأة ولاء داخلية." });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
  reviewReward: protectedProcedure.input(z.object({ rewardId: z.number().int().positive(), decision: z.enum(["approved", "archived"]), note: z.string().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "loyalty.approve");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const result = await reviewLoyaltyReward({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "loyalty_reward", entityId: input.rewardId, action: input.decision, summary: input.decision === "approved" ? "اعتمد مكافأة ولاء داخلية." : "أرشف مكافأة ولاء قبل اعتمادها." });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
  archiveReward: protectedProcedure.input(z.object({ rewardId: z.number().int().positive(), note: z.string().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "loyalty.manage");
    const activeStoreId = storeId(ctx.operationalStore);
    try {
      const result = await archiveLoyaltyReward({ ...input, storeId: activeStoreId, actorUserId: ctx.user.id });
      await recordAuditEvent({ storeId: activeStoreId, actorUserId: ctx.user.id, entityType: "loyalty_reward", entityId: input.rewardId, action: "archived", summary: "أرشف مكافأة ولاء داخلية." });
      return result;
    } catch (error) { throw toTrpcError(error); }
  }),
});
