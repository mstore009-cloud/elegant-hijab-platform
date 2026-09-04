import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import { protectedProcedure, router } from "../_core/trpc";
import {
  assignInboxConversation,
  changeInboxConversationStatus,
  createManualConversation,
  getInboxConversationDetail,
  inboxChannels,
  inboxMessageDirections,
  inboxStatuses,
  linkInboxConversationCustomer,
  linkInboxConversationOrder,
  listInboxAssignableEmployees,
  listInboxConversations,
  listInboxMetaActivity,
  listInboxCustomers,
  recordInboxMessage,
  setInboxConversationPriority,
  snoozeInboxConversation,
} from "../inbox/db";
import { sendMetaConversationMessage } from "../channels/metaOutbound";

const conversationIdInput = z.object({ conversationId: z.number().int().positive() });
const inboxStatusSchema = z.enum(inboxStatuses);
const inboxChannelSchema = z.enum(inboxChannels);

async function requireInboxStore(ctx: { user: NonNullable<any>; operationalStore: { id: number } | null }, permission: "inbox.read" | "inbox.reply" | "inbox.manage") {
  if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
  await assertPermission(ctx.user, permission, ctx.operationalStore.id);
  return ctx.operationalStore;
}

export const inboxRouter = router({
  list: protectedProcedure.input(z.object({ search: z.string().trim().max(240).optional(), status: inboxStatusSchema.optional(), channel: inboxChannelSchema.optional(), assignment: z.enum(["all", "mine", "unassigned"]).optional(), limit: z.number().int().min(1).max(200).optional() }).optional()).query(async ({ ctx, input }) => {
    const store = await requireInboxStore(ctx, "inbox.read");
    return listInboxConversations(store.id, ctx.user.id, input ?? {});
  }),
  detail: protectedProcedure.input(conversationIdInput).query(async ({ ctx, input }) => getInboxConversationDetail((await requireInboxStore(ctx, "inbox.read")).id, input.conversationId)),
  metaActivity: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()).query(async ({ ctx, input }) => listInboxMetaActivity((await requireInboxStore(ctx, "inbox.read")).id, input?.limit)),
  assignees: protectedProcedure.query(async ({ ctx }) => listInboxAssignableEmployees((await requireInboxStore(ctx, "inbox.read")).id)),
  customers: protectedProcedure.input(z.object({ search: z.string().trim().max(160).optional() }).optional()).query(async ({ ctx, input }) => listInboxCustomers((await requireInboxStore(ctx, "inbox.read")).id, input?.search)),
  createManual: protectedProcedure.input(z.object({ customerId: z.number().int().positive().nullable().optional(), orderId: z.number().int().positive().nullable().optional(), subject: z.string().trim().max(240).nullable().optional(), contactName: z.string().trim().max(160).nullable().optional(), contactPhone: z.string().trim().max(40).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireInboxStore(ctx, "inbox.manage");
    const result = await createManualConversation({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "inbox_conversation", entityId: result.conversationId, action: "inbox.conversation_created", summary: "تم إنشاء سجل محادثة يدوي." });
    return result;
  }),
  recordMessage: protectedProcedure.input(conversationIdInput.extend({ direction: z.enum(inboxMessageDirections), body: z.string().trim().min(1).max(4000) })).mutation(async ({ ctx, input }) => {
    const store = await requireInboxStore(ctx, input.direction === "internal_note" ? "inbox.manage" : "inbox.reply");
    const result = await recordInboxMessage({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "inbox_conversation", entityId: input.conversationId, action: input.direction === "internal_note" ? "inbox.note_added" : "inbox.message_recorded", summary: input.direction === "internal_note" ? "أضيفت ملاحظة داخلية للمحادثة." : "تم حفظ سجل رسالة يدويًا؛ لم تُرسل إلى قناة خارجية." });
    return result;
  }),
  sendManualMeta: protectedProcedure.input(conversationIdInput.extend({ body: z.string().trim().min(1).max(4000), idempotencyKey: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const store = await requireInboxStore(ctx, "inbox.reply");
    const result = await sendMetaConversationMessage({ ...input, storeId: store.id, actorUserId: ctx.user.id, mode: "manual" });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "inbox_conversation", entityId: input.conversationId, action: "inbox.meta_manual_sent", summary: "أرسل الموظف رسالة يدوية عبر قناة Meta المرتبطة؛ لا يوجد رد آلي في هذه العملية." });
    return result;
  }),
  assign: protectedProcedure.input(conversationIdInput.extend({ assigneeEmployeeId: z.number().int().positive().nullable().optional() })).mutation(async ({ ctx, input }) => {
    const store = await requireInboxStore(ctx, "inbox.manage");
    const assignee = await assignInboxConversation({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "inbox_conversation", entityId: input.conversationId, action: "inbox.assigned", summary: assignee ? `أُسندت المحادثة إلى ${assignee.displayName}.` : "أُعيدت المحادثة إلى الطابور غير المعيّن." });
  }),
  changeStatus: protectedProcedure.input(conversationIdInput.extend({ status: inboxStatusSchema })).mutation(async ({ ctx, input }) => {
    const store = await requireInboxStore(ctx, "inbox.manage");
    await changeInboxConversationStatus({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "inbox_conversation", entityId: input.conversationId, action: "inbox.status_changed", summary: "تم تحديث حالة المحادثة." });
  }),
  setPriority: protectedProcedure.input(conversationIdInput.extend({ priority: z.boolean() })).mutation(async ({ ctx, input }) => {
    const store = await requireInboxStore(ctx, "inbox.manage");
    await setInboxConversationPriority({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "inbox_conversation", entityId: input.conversationId, action: "inbox.priority_changed", summary: input.priority ? "وُسمت المحادثة كأولوية." : "أزيلت أولوية المحادثة." });
  }),
  snooze: protectedProcedure.input(conversationIdInput.extend({ until: z.date() })).mutation(async ({ ctx, input }) => {
    const store = await requireInboxStore(ctx, "inbox.manage");
    await snoozeInboxConversation({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "inbox_conversation", entityId: input.conversationId, action: "inbox.snoozed", summary: "تم تأجيل المحادثة." });
  }),
  linkCustomer: protectedProcedure.input(conversationIdInput.extend({ customerId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const store = await requireInboxStore(ctx, "inbox.manage");
    await linkInboxConversationCustomer({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "inbox_conversation", entityId: input.conversationId, action: "inbox.customer_linked", summary: "رُبطت المحادثة بملف عميل." });
  }),
  linkOrder: protectedProcedure.input(conversationIdInput.extend({ orderId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const store = await requireInboxStore(ctx, "inbox.manage");
    await linkInboxConversationOrder({ ...input, storeId: store.id, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId: store.id, actorUserId: ctx.user.id, entityType: "inbox_conversation", entityId: input.conversationId, action: "inbox.order_linked", summary: "رُبطت المحادثة بطلب." });
  }),
});
