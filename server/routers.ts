import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { accessRouter } from "./routers/access";
import { productsRouter } from "./routers/products";
import { integrationsRouter } from "./routers/integrations";
import { contentRouter } from "./routers/content";
import { catalogSyncRouter } from "./routers/catalogSync";
import { ordersRouter } from "./routers/orders";
import { storesRouter } from "./routers/stores";
import { crmRouter } from "./routers/crm";
import { inboxRouter } from "./routers/inbox";
import { customerBotRouter } from "./routers/customerBot";
import { marketingRouter } from "./routers/marketing";
import { analyticsRouter } from "./routers/analytics";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  access: accessRouter,
  products: productsRouter,
  integrations: integrationsRouter,
  content: contentRouter,
  catalogSync: catalogSyncRouter,
  orders: ordersRouter,
  stores: storesRouter,
  crm: crmRouter,
  inbox: inboxRouter,
  customerBot: customerBotRouter,
  marketing: marketingRouter,
  analytics: analyticsRouter,

});

export type AppRouter = typeof appRouter;
