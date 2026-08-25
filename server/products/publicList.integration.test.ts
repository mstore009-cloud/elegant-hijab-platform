import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

describe("products.publicList integration", () => {
  it("does not expose HJB-TEST-001 while the product remains draft", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const products = await caller.products.publicList();

    expect(products.some(product => product.productCode === "HJB-TEST-001")).toBe(false);
    expect(products.every(product => "defaultColorName" in product)).toBe(true);
  }, 15_000);
});
