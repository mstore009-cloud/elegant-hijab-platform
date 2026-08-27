import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { recordAuditEvent } from "../audit/db";
import {
  archiveContentPost,
  attachContentPostMediaToProduct,
  createContentPostDraft,
  getContentPostDraft,
  listContentPostDrafts,
  requestContentPostReview,
  reviewContentPost,
  saveContentPostMedia,
  updateContentPost,
} from "../content/db";
import { storagePut } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";

const MAX_POST_MEDIA_BYTES = 20 * 1024 * 1024;
const contentStatusSchema = z.enum(["draft", "needs_review", "approved", "changes_requested", "archived"]);
const contentTypeSchema = z.enum(["feed_post", "story", "reel", "catalog", "other"]);
const channelPlanSchema = z.enum(["general", "facebook", "instagram", "tiktok", "whatsapp"]);

function safeFileName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 180) || "post-image";
}

function requireOperationalStore(store: { id: number } | null | undefined) {
  if (!store) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للمستخدم." });
  return store.id;
}

const contentFieldsSchema = z.object({
  productId: z.number().int().positive().nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  contentType: contentTypeSchema.optional(),
  channelPlan: channelPlanSchema.optional(),
  plannedFor: z.date().nullable().optional(),
  caption: z.string().max(4000).nullable().optional(),
});

export const contentRouter = router({
  listDrafts: protectedProcedure
    .input(z.object({ status: contentStatusSchema.optional(), channelPlan: channelPlanSchema.optional(), from: z.date().optional(), to: z.date().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await assertPermission(ctx.user, "content.view");
      return listContentPostDrafts({ storeId: requireOperationalStore(ctx.operationalStore), ...input });
    }),
  byId: protectedProcedure.input(z.object({ postId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "content.view");
    const draft = await getContentPostDraft(input.postId, requireOperationalStore(ctx.operationalStore));
    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "مسودة المنشور غير موجودة." });
    return draft;
  }),
  createDraft: protectedProcedure.input(contentFieldsSchema).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "content.manage");
    const storeId = requireOperationalStore(ctx.operationalStore);
    const postId = await createContentPostDraft({ ...input, storeId, createdByUserId: ctx.user.id });
    await recordAuditEvent({ storeId, actorUserId: ctx.user.id, entityType: "content_post", entityId: postId, action: "created", summary: "أنشأ مسودة محتوى." });
    return { postId, status: "draft" as const };
  }),
  update: protectedProcedure.input(contentFieldsSchema.extend({ postId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "content.manage");
    const storeId = requireOperationalStore(ctx.operationalStore);
    const { postId, ...fields } = input;
    const draft = await updateContentPost({ ...fields, storeId, postId, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId, actorUserId: ctx.user.id, entityType: "content_post", entityId: postId, action: "updated", summary: "عدّل مسودة محتوى." });
    return draft;
  }),
  requestReview: protectedProcedure.input(z.object({ postId: z.number().int().positive(), note: z.string().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "content.manage");
    const storeId = requireOperationalStore(ctx.operationalStore);
    const result = await requestContentPostReview({ ...input, storeId, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId, actorUserId: ctx.user.id, entityType: "content_post", entityId: input.postId, action: "review_requested", summary: "طلب مراجعة مسودة محتوى." });
    return result;
  }),
  review: protectedProcedure.input(z.object({ postId: z.number().int().positive(), decision: z.enum(["approved", "changes_requested"]), note: z.string().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "content.approve");
    const storeId = requireOperationalStore(ctx.operationalStore);
    const result = await reviewContentPost({ ...input, storeId, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId, actorUserId: ctx.user.id, entityType: "content_post", entityId: input.postId, action: input.decision, summary: input.decision === "approved" ? "اعتمد مسودة محتوى داخلياً." : "طلب تعديلاً على مسودة محتوى." });
    return result;
  }),
  archive: protectedProcedure.input(z.object({ postId: z.number().int().positive(), note: z.string().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "content.manage");
    const storeId = requireOperationalStore(ctx.operationalStore);
    const result = await archiveContentPost({ ...input, storeId, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId, actorUserId: ctx.user.id, entityType: "content_post", entityId: input.postId, action: "archived", summary: "أرشف مسودة محتوى." });
    return result;
  }),
  uploadPostMedia: protectedProcedure.input(z.object({
    postId: z.number().int().positive(),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().regex(/^image\/(jpeg|png|webp)$/),
    base64Data: z.string().min(1),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "content.manage");
    const storeId = requireOperationalStore(ctx.operationalStore);
    const bytes = Buffer.from(input.base64Data, "base64");
    if (bytes.length === 0 || bytes.length > MAX_POST_MEDIA_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "حجم صورة المنشور يجب أن يكون بين 1 بايت و20 ميغابايت." });
    const uploaded = await storagePut(`content/posts/${input.postId}/manual/${safeFileName(input.fileName)}`, bytes, input.mimeType);
    const mediaId = await saveContentPostMedia({ storeId, postId: input.postId, storageKey: uploaded.key, originalFileName: input.fileName, mimeType: input.mimeType, byteSize: bytes.length, actorUserId: ctx.user.id });
    await recordAuditEvent({ storeId, actorUserId: ctx.user.id, entityType: "content_post", entityId: input.postId, action: "media_added", summary: "أضاف وسيطاً لمسودة محتوى." });
    return { mediaId, storageKey: uploaded.key, url: uploaded.url, attachedToProduct: false as const };
  }),
  attachPostMediaToProduct: protectedProcedure.input(z.object({ postId: z.number().int().positive(), postMediaId: z.number().int().positive(), productId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "content.manage");
    await assertPermission(ctx.user, "products.edit");
    const storeId = requireOperationalStore(ctx.operationalStore);
    return attachContentPostMediaToProduct({ ...input, storeId });
  }),
});
