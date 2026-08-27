import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import {
  addCustomerNote,
  assignCustomerTag,
  changeCustomerTaskStatus,
  createCustomerTag,
  createCustomerTask,
  customerRelationshipStages,
  customerTaskStatuses,
  getCustomerDetail,
  listAssignableCustomerTaskEmployees,
  listCustomers,
  listCustomerTags,
  removeCustomerTag,
  updateCustomerProfile,
} from "../crm/db";
import { protectedProcedure, router } from "../_core/trpc";

const customerIdInput = z.object({ customerId: z.number().int().positive() });
const stageSchema = z.enum(customerRelationshipStages);

async function requireCrmStore(ctx: { user: NonNullable<any>; operationalStore: { id: number } | null }, permission: "crm.view" | "crm.manage") {
  if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
  await assertPermission(ctx.user, permission, ctx.operationalStore.id);
  return ctx.operationalStore;
}

export const crmRouter = router({
  list: protectedProcedure.input(z.object({ search: z.string().trim().max(160).optional(), stage: stageSchema.optional(), tagId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(200).optional() }).optional()).query(async ({ ctx, input }) => {
    const store = await requireCrmStore(ctx, "crm.view");
    return listCustomers(store.id, input ?? {});
  }),
  detail: protectedProcedure.input(customerIdInput).query(async ({ ctx, input }) => {
    const store = await requireCrmStore(ctx, "crm.view");
    const detail = await getCustomerDetail(store.id, input.customerId);
    if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "ملف العميل غير موجود." });
    return detail;
  }),
  tags: protectedProcedure.query(async ({ ctx }) => listCustomerTags((await requireCrmStore(ctx, "crm.view")).id)),
  taskAssignees: protectedProcedure.query(async ({ ctx }) => listAssignableCustomerTaskEmployees((await requireCrmStore(ctx, "crm.view")).id)),
  createTag: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(80), color: z.string().trim().max(24).optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireCrmStore(ctx, "crm.manage");
    const tag = await createCustomerTag({ storeId: store.id, name: input.name, color: input.color ?? "slate", actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_tag", entityId: tag.id, action: "crm.tag_created", summary: `تم إنشاء وسم العملاء «${tag.name}».` });
    return tag;
  }),
  updateProfile: protectedProcedure.input(customerIdInput.extend({ displayName: z.string().trim().min(1).max(160), phoneDisplay: z.string().trim().min(7).max(40), governorate: z.string().trim().max(120).nullable().optional(), lastAddress: z.string().trim().max(4000).nullable().optional(), relationshipStage: stageSchema })).mutation(async ({ ctx, input }) => {
    const store = await requireCrmStore(ctx, "crm.manage");
    await updateCustomerProfile({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_profile", entityId: input.customerId, action: "crm.profile_updated", summary: `تم تحديث ملف العميل ${input.displayName}.` });
  }),
  addNote: protectedProcedure.input(customerIdInput.extend({ body: z.string().trim().min(1).max(4000) })).mutation(async ({ ctx, input }) => {
    const store = await requireCrmStore(ctx, "crm.manage");
    await addCustomerNote({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_profile", entityId: input.customerId, action: "crm.note_added", summary: "أضيفت ملاحظة داخلية إلى ملف عميل." });
  }),
  assignTag: protectedProcedure.input(customerIdInput.extend({ tagId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const store = await requireCrmStore(ctx, "crm.manage");
    const tag = await assignCustomerTag({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_profile", entityId: input.customerId, action: "crm.tag_assigned", summary: `أُضيف وسم «${tag.name}» إلى ملف عميل.` });
  }),
  removeTag: protectedProcedure.input(customerIdInput.extend({ tagId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const store = await requireCrmStore(ctx, "crm.manage");
    await removeCustomerTag({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_profile", entityId: input.customerId, action: "crm.tag_removed", summary: "أُزيل وسم من ملف عميل." });
  }),
  createTask: protectedProcedure.input(customerIdInput.extend({ title: z.string().trim().min(1).max(220), note: z.string().trim().max(4000).nullable().optional(), dueAt: z.date().nullable().optional(), assigneeEmployeeId: z.number().int().positive().nullable().optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireCrmStore(ctx, "crm.manage");
    const task = await createCustomerTask({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_task", entityId: task.taskId, action: "crm.task_created", summary: `تم إنشاء مهمة متابعة للعميل.` });
    return task;
  }),
  changeTaskStatus: protectedProcedure.input(customerIdInput.extend({ taskId: z.number().int().positive(), status: z.enum(customerTaskStatuses) })).mutation(async ({ ctx, input }) => {
    const store = await requireCrmStore(ctx, "crm.manage");
    await changeCustomerTaskStatus({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "customer_task", entityId: input.taskId, action: "crm.task_status_changed", summary: "تم تحديث حالة مهمة متابعة." });
  }),
});
