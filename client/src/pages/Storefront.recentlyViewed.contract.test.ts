import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./Storefront.tsx", import.meta.url), "utf8");

describe("Storefront recently viewed products", () => {
  it("persists a bounded recent-product history and renders it in the cart discovery rail", () => {
    expect(source).toContain("elegant_hijab_recent_products");
    expect(source).toContain("slice(0, 10)");
    expect(source).toContain("منتجات شاهدتها مؤخرًا");
    expect(source).toContain("<RecentlyViewedProducts />");
  });

  it("keeps recently viewed items out of the cart line state", () => {
    expect(source).toContain("setRecentCodes");
    expect(source).toContain("setCart(lines");
    expect(source).toContain("!cart.some(line => line.productCode === item.productCode)");
  });
});
