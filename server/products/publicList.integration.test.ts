import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

describe("products.publicList integration", () => {
  it("يعيد عناصر عامة جاهزة للبطاقة من دون افتراض حالة منتج حي بعينه", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const products = await caller.products.publicList();

    expect(Array.isArray(products)).toBe(true);
    expect(products.every(product => "defaultColorName" in product)).toBe(true);
  }, 15_000);
});
