import { z } from "zod";
import { assertPermission } from "../access/authorization";
import { addOrderContactEvent, contactOutcomes, createStorefrontOrder, customerChannels, getOperationalOrder, getPublicDeliveryFee, listDeliveryRates, listOperationalOrders, orderStatuses, saveDeliveryRate, transitionOrderStatus, updateOrderCommercialTerms } from "../orders/db";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";

const orderStatus = z.enum(orderStatuses);

function requiredPermissionForStatus(status: (typeof orderStatuses)[number]) {
  if (status === "confirmed" || status === "needs_contact") return "orders.confirm" as const;
  if (status === "preparing" || status === "completed") return "orders.fulfill" as const;
  if (status === "out_for_delivery") return "orders.delivery.submit" as const;
  return "orders.cancel" as const;
}

export const ordersRouter = router({
  publicDeliveryFee: publicProcedure.input(z.object({ governorate: z.string().trim().max(120) })).query(({ input }) => getPublicDeliveryFee(input.governorate)),
  createFromStorefront: publicProcedure.input(z.object({
    items: z.array(z.object({ productCode: z.string().trim().min(1).max(80), colorName: z.string().trim().min(1).max(100), quantity: z.number().int().min(1).max(100) })).min(1).max(30),
    customerName: z.string().trim().min(2).max(160),
    customerPhone: z.string().trim().min(6).max(40),
    governorate: z.string().trim().min(2).max(120),
    address: z.string().trim().min(5).max(2000),
    customerNote: z.string().trim().max(2000).optional(),
  })).mutation(async ({ input }) => createStorefrontOrder(input)),
  list: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "orders.view");
    return listOperationalOrders();
  }),
  deliveryRates: protectedProcedure.query(async ({ ctx }) => {
    await assertPermission(ctx.user, "orders.confirm");
    return listDeliveryRates();
  }),
  saveDeliveryRate: protectedProcedure.input(z.object({ governorate: z.string().trim().min(2).max(120), fee: z.number().min(0).max(10000000), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "orders.confirm");
    return saveDeliveryRate({ ...input, actorUserId: ctx.user.id });
  }),
  byId: protectedProcedure.input(z.object({ orderId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "orders.view");
    return getOperationalOrder(input.orderId);
  }),
  transition: protectedProcedure.input(z.object({ orderId: z.number().int().positive(), nextStatus: orderStatus, note: z.string().trim().max(2000).optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, requiredPermissionForStatus(input.nextStatus));
    return transitionOrderStatus({ ...input, actorUserId: ctx.user.id });
  }),
  updateCommercialTerms: protectedProcedure.input(z.object({ orderId: z.number().int().positive(), deliveryFee: z.number().min(0).max(10000000), manualDiscount: z.number().min(0).max(10000000), customerChannel: z.enum(customerChannels) })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "orders.confirm");
    return updateOrderCommercialTerms({ ...input, actorUserId: ctx.user.id });
  }),
  addContactEvent: protectedProcedure.input(z.object({ orderId: z.number().int().positive(), channel: z.enum(customerChannels), outcome: z.enum(contactOutcomes), note: z.string().trim().max(2000).optional() })).mutation(async ({ ctx, input }) => {
    await assertPermission(ctx.user, "orders.confirm");
    return addOrderContactEvent({ ...input, actorUserId: ctx.user.id });
  }),
});
