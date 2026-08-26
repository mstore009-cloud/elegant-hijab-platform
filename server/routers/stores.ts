import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getOperationalStoreContext } from "../stores/db";

export const storesRouter = router({
  current: protectedProcedure.query(async ({ ctx }) => {
    const context = await getOperationalStoreContext(ctx.user);
    if (!context) {
      throw new TRPCError({ code: "FORBIDDEN", message: "لا يوجد متجر تشغيلي مخصص لهذا المستخدم." });
    }
    return context;
  }),
});
