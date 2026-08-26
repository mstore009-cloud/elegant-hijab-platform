import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { createContentPostDraft, getContentPostDraft, listContentPostDrafts, saveContentPostMedia, attachContentPostMediaToProduct } from "../content/db";
import { storagePut } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";

const MAX_POST_MEDIA_BYTES = 20 * 1024 * 1024;

function safeFileName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 180) || "post-image";
}

export const contentRouter = router({
  listDrafts: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "marketing.manage");
    if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للمستخدم." });
    return listContentPostDrafts(ctx.operationalStore.id);
  }),
  byId: protectedProcedure.input(z.object({ postId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.manage");
    if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للمستخدم." });
    const draft = await getContentPostDraft(input.postId, ctx.operationalStore.id);
    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "مسودة المنشور غير موجودة." });
    return draft;
  }),
  createDraft: protectedProcedure.input(z.object({ productId: z.number().int().positive().optional(), caption: z.string().max(4000).optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.manage");
    if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للمستخدم." });
    return { postId: await createContentPostDraft({ ...input, storeId: ctx.operationalStore.id, createdByUserId: ctx.user.id }), status: "draft" as const };
  }),
  uploadPostMedia: protectedProcedure.input(z.object({
    postId: z.number().int().positive(),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().regex(/^image\/(jpeg|png|webp)$/),
    base64Data: z.string().min(1),
  })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.manage");
    if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للمستخدم." });
    const bytes = Buffer.from(input.base64Data, "base64");
    if (bytes.length === 0 || bytes.length > MAX_POST_MEDIA_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "حجم صورة المنشور يجب أن يكون بين 1 بايت و20 ميغابايت." });
    const uploaded = await storagePut(`content/posts/${input.postId}/manual/${safeFileName(input.fileName)}`, bytes, input.mimeType);
    const mediaId = await saveContentPostMedia({ storeId: ctx.operationalStore.id, postId: input.postId, storageKey: uploaded.key, originalFileName: input.fileName, mimeType: input.mimeType, byteSize: bytes.length });
    return { mediaId, storageKey: uploaded.key, url: uploaded.url, attachedToProduct: false as const };
  }),
  attachPostMediaToProduct: protectedProcedure.input(z.object({ postId: z.number().int().positive(), postMediaId: z.number().int().positive(), productId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "marketing.manage");
    await assertPermission(ctx.user, "products.edit");
    if (!ctx.operationalStore) throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص للمستخدم." });
    return attachContentPostMediaToProduct({ ...input, storeId: ctx.operationalStore.id });
  }),
});
