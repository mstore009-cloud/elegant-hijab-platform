import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { addOrderContactEvent, contactOutcomes, createStorefrontOrder, customerChannels, getOperationalOrder, getPublicDeliveryFee, getPublicStoreSettings, getStoreSettingsForStaff, listDeliveryRates, listOperationalOrders, listPromotionCoupons, orderStatuses, saveDeliveryRate, savePromotionCoupon, saveStoreSettings, transitionOrderStatus, validatePublicCoupon } from "../orders/db";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";

const orderStatus = z.enum(orderStatuses);

function requiredPermissionForStatus(status: (typeof orderStatuses)[number]) {
  if (status === "confirmed" || status === "needs_contact") return "orders.confirm" as const;
  if (status === "preparing" || status === "completed") return "orders.fulfill" as const;
  if (status === "out_for_delivery") return "orders.delivery.submit" as const;
  return "orders.cancel" as const;
}

export const ordersRouter = router({
  publicStoreSettings: publicProcedure.query(() => getPublicStoreSettings()),
  publicDeliveryFee: publicProcedure.query(() => getPublicDeliveryFee()),
  validateCoupon: publicProcedure.input(z.object({ code: z.string().trim().max(80), subtotal: z.number().min(0) })).query(({ input }) => validatePublicCoupon(input.code, input.subtotal)),
  createFromStorefront: publicProcedure.input(z.object({
    items: z.array(z.object({ productCode: z.string().trim().min(1).max(80), colorName: z.string().trim().min(1).max(100), quantity: z.number().int().min(1).max(100) })).min(1).max(30),
    customerName: z.string().trim().min(2).max(160),
    customerPhone: z.string().trim().min(6).max(40),
    governorate: z.string().trim().min(2).max(120),
    address: z.string().trim().min(5).max(2000),
    customerNote: z.string().trim().max(2000).optional(),
    couponCode: z.string().trim().max(80).optional(),
  })).mutation(async ({ input }) => createStorefrontOrder(input)),
  list: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "orders.view");
    return listOperationalOrders();
  }),
  deliveryRates: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "settings.manage");
    return listDeliveryRates();
  }),
  saveDeliveryRate: protectedProcedure.input(z.object({ governorate: z.string().trim().min(2).max(120), fee: z.number().min(0).max(10000000), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "settings.manage");
    return saveDeliveryRate({ ...input, actorUserId: ctx.user.id });
  }),
  storeSettings: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "settings.manage");
    return getStoreSettingsForStaff();
  }),
  saveStoreSettings: protectedProcedure.input(z.object({ defaultLanguage: z.string().trim().min(2).max(16), currencyCode: z.string().trim().min(3).max(8), defaultDeliveryFee: z.number().min(0).max(10000000) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "settings.manage");
    return saveStoreSettings({ ...input, actorUserId: ctx.user.id });
  }),
  coupons: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "settings.manage");
    return listPromotionCoupons();
  }),
  saveCoupon: protectedProcedure.input(z.object({ id: z.number().int().positive().optional(), code: z.string().trim().min(2).max(80), discountType: z.enum(["fixed", "percent"]), discountValue: z.number().min(0).max(10000000), minimumSubtotal: z.number().min(0).max(100000000), startsAt: z.coerce.date().nullable().optional(), endsAt: z.coerce.date().nullable().optional(), usageLimit: z.number().int().positive().nullable().optional(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "settings.manage");
    return savePromotionCoupon({ ...input, actorUserId: ctx.user.id });
  }),
  byId: protectedProcedure.input(z.object({ orderId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "orders.view");
    return getOperationalOrder(input.orderId);
  }),
  transition: protectedProcedure.input(z.object({ orderId: z.number().int().positive(), nextStatus: orderStatus, note: z.string().trim().max(2000).optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, requiredPermissionForStatus(input.nextStatus));
    return transitionOrderStatus({ ...input, actorUserId: ctx.user.id });
  }),
  addContactEvent: protectedProcedure.input(z.object({ orderId: z.number().int().positive(), channel: z.enum(customerChannels), outcome: z.enum(contactOutcomes), note: z.string().trim().max(2000).optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "orders.confirm");
    return addOrderContactEvent({ ...input, actorUserId: ctx.user.id });
  }),
});
