import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogMocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  listChildren: vi.fn(),
  generateOperational: vi.fn(),
}));

vi.mock("../integrations/onedrive/catalogAuth", () => ({
  getUsableCatalogConnection: catalogMocks.getConnection,
}));
vi.mock("../integrations/onedrive/catalog", () => ({
  listCatalogChildren: catalogMocks.listChildren,
  readCatalogTextFile: vi.fn(),
}));
vi.mock("./operationalMediaService", () => ({
  generateOperationalMediaForProduct: catalogMocks.generateOperational,
}));

import { catalogFolderImports, productImportJobs, productOperations, products, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { scanCatalogForOwner } from "./catalogAutomation";
import { updateProductDetails } from "./db";

describe("Catalog التلقائي للمجلد الناقص", () => {
  beforeEach(() => {
    catalogMocks.getConnection.mockReset();
    catalogMocks.listChildren.mockReset();
    catalogMocks.generateOperational.mockReset();
    catalogMocks.generateOperational.mockResolvedValue({ created: [] });
  });

  it("ينشئ مسودة ناقصة قابلة للتحرير، يسجل النواقص، ولا يجعلها منتجًا عامًا", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار Catalog التلقائي.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار Catalog التلقائي.");

    const productCode = `TST-INCOMPLETE-${randomUUID().slice(0, 10)}`;
    const folderId = `folder-${productCode}`;
    let productId: number | null = null;
    catalogMocks.getConnection.mockResolvedValue({
      status: "catalog_selected",
      selectedDriveId: "drive-test",
      selectedFolderId: "catalog-root",
      encryptedAccessToken: "encrypted-test-token",
    });
    catalogMocks.listChildren.mockImplementation(async ({ folderId: requestedFolderId }: { folderId: string }) => {
      if (requestedFolderId === "catalog-root") return [{ id: "group-hijab", name: "حجابات اختبار", kind: "folder" }];
      if (requestedFolderId === "group-hijab") return [{ id: folderId, name: productCode, kind: "folder" }];
      if (requestedFolderId === folderId) return [];
      return [];
    });

    try {
      const summary = await scanCatalogForOwner(owner.id);
      expect(summary).toMatchObject({ discovered: 1, draftsCreated: 1, existing: 0, failed: 0, operationalCopiesCreated: 0 });

      const [draft] = await db.select().from(products).where(eq(products.productCode, productCode)).limit(1);
      expect(draft).toMatchObject({
        status: "draft",
        category: "حجابات اختبار",
        name: `منتج يحتاج بيانات — ${productCode}`,
        sellingPrice: "0.00",
      });
      productId = draft!.id;
      const [folder] = await db.select().from(catalogFolderImports).where(and(eq(catalogFolderImports.ownerUserId, owner.id), eq(catalogFolderImports.productFolderId, folderId))).limit(1);
      expect(JSON.parse(folder!.missingFields ?? "[]")).toEqual(expect.arrayContaining(["product.txt", "images", "colors", "inventory"]));
      const [job] = await db.select().from(productImportJobs).where(eq(productImportJobs.linkedProductId, productId)).limit(1);
      expect(job).toMatchObject({ status: "needs_review" });

      const updated = await updateProductDetails({
        productId,
        description: "وصف استكمل من واجهة المنتجات",
        sellingPrice: "9000",
        sizeLabels: ["Medium", "Large"],
        actorUserId: owner.id,
        source: "products_ui",
      });
      expect(updated.product).toMatchObject({ status: "draft", description: "وصف استكمل من واجهة المنتجات", sellingPrice: "9000.00" });
      expect(updated.missingFields).toEqual(expect.arrayContaining(["product.txt", "images", "colors", "inventory"]));
      expect(updated.missingFields).not.toContain("description");
      expect(updated.missingFields).not.toContain("sellingPrice");
    } finally {
      if (productId) {
        await db.delete(productOperations).where(eq(productOperations.productId, productId));
        await db.delete(productImportJobs).where(eq(productImportJobs.linkedProductId, productId));
        await db.delete(catalogFolderImports).where(eq(catalogFolderImports.linkedProductId, productId));
        await db.delete(products).where(eq(products.id, productId));
      }
    }
  }, 15_000);
});
