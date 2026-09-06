import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogMocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  listChildren: vi.fn(),
  readTextFile: vi.fn(),
  generateOperational: vi.fn(),
  generateOperationalVideos: vi.fn(),
  notifyPermissionHolders: vi.fn(),
}));

vi.mock("../integrations/onedrive/catalogAuth", () => ({
  getUsableCatalogConnection: catalogMocks.getConnection,
}));
vi.mock("../integrations/onedrive/catalog", () => ({
  listCatalogChildren: catalogMocks.listChildren,
  readCatalogTextFile: catalogMocks.readTextFile,
}));
vi.mock("./operationalMediaService", () => ({
  generateOperationalMediaForProduct: catalogMocks.generateOperational,
  generateOperationalVideosForProduct: catalogMocks.generateOperationalVideos,
}));
vi.mock("../notifications/db", () => ({
  notifyPermissionHolders: catalogMocks.notifyPermissionHolders,
}));

import { catalogFolderImports, catalogGroupImports, productImportJobs, productMedia, productOperations, products, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { getPublicStore } from "../stores/db";
import { scanCatalogForOwner } from "./catalogAutomation";
import { updateProductDetails } from "./db";

describe("Catalog التلقائي للمجلد الناقص", () => {
  beforeEach(() => {
    catalogMocks.getConnection.mockReset();
    catalogMocks.listChildren.mockReset();
    catalogMocks.readTextFile.mockReset();
    catalogMocks.generateOperational.mockReset();
    catalogMocks.generateOperationalVideos.mockReset();
    catalogMocks.notifyPermissionHolders.mockReset();
    catalogMocks.generateOperational.mockResolvedValue({ created: [] });
    catalogMocks.generateOperationalVideos.mockResolvedValue({ created: [] });
  });

  it("ينشئ مسودة ناقصة قابلة للتحرير، يسجل النواقص، ولا يجعلها منتجًا عامًا", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار Catalog التلقائي.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار Catalog التلقائي.");
    const store = await getPublicStore();
    if (!store) throw new Error("لا يوجد متجر افتراضي لاختبار Catalog التلقائي.");

    const productCode = `TST-INCOMPLETE-${randomUUID().slice(0, 10)}`;
    const folderId = `folder-${productCode}`;
    let productId: number | null = null;
    const progressEvents: Array<{ stage: string; processedFolders: number; totalFolders: number; currentProduct?: string | null }> = [];
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
      const summary = await scanCatalogForOwner({ ownerUserId: owner.id, storeId: store.id, onProgress: progress => { progressEvents.push(progress); } });
      expect(summary).toMatchObject({ discovered: 1, draftsCreated: 1, existing: 0, failed: 0, operationalCopiesCreated: 0 });
      expect(progressEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: "discovering_folders", processedFolders: 0, totalFolders: 1 }),
        expect.objectContaining({ stage: "reading_product", currentProduct: productCode, totalFolders: 1 }),
        expect.objectContaining({ stage: "processing_folders", processedFolders: 1, totalFolders: 1 }),
      ]));

      const [draft] = await db.select().from(products).where(and(eq(products.storeId, store.id), eq(products.productCode, productCode))).limit(1);
      expect(draft).toMatchObject({
        status: "draft",
        category: "حجابات اختبار",
        name: `منتج يحتاج بيانات — ${productCode}`,
        sellingPrice: "0.00",
      });
      productId = draft!.id;
      const [folder] = await db.select().from(catalogFolderImports).where(and(eq(catalogFolderImports.storeId, store.id), eq(catalogFolderImports.ownerUserId, owner.id), eq(catalogFolderImports.productFolderId, folderId))).limit(1);
      expect(JSON.parse(folder!.missingFields ?? "[]")).toEqual(expect.arrayContaining(["product.txt", "images"]));
      expect(JSON.parse(folder!.missingFields ?? "[]")).not.toEqual(expect.arrayContaining(["colors", "inventory"]));
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
      expect(updated.missingFields).toEqual(expect.arrayContaining(["product.txt", "images"]));
      expect(updated.missingFields).not.toEqual(expect.arrayContaining(["colors", "inventory"]));
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

  it("ينشئ مسودة Code مع الصورة الموجودة حتى عند غياب product.txt", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار مسودة الصورة.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    const store = await getPublicStore();
    if (!owner || !store) throw new Error("لا توجد بيانات تشغيلية لاختبار مسودة الصورة.");
    const productCode = `TST-IMAGE-${randomUUID().slice(0, 10)}`;
    const groupId = `group-${productCode}`;
    const folderId = `folder-${productCode}`;
    let productId: number | null = null;
    catalogMocks.getConnection.mockResolvedValue({ status: "catalog_selected", selectedDriveId: "drive-test", selectedFolderId: "catalog-root", encryptedAccessToken: "encrypted-test-token" });
    catalogMocks.listChildren.mockImplementation(async ({ folderId: requestedFolderId }: { folderId: string }) => {
      if (requestedFolderId === "catalog-root") return [{ id: groupId, name: "ربطات", kind: "folder" }];
      if (requestedFolderId === groupId) return [{ id: folderId, name: productCode, kind: "folder" }];
      if (requestedFolderId === folderId) return [{ id: "image-1", name: "front.webp", kind: "file", webUrl: "https://onedrive.test/front.webp" }];
      return [];
    });
    try {
      const summary = await scanCatalogForOwner({ ownerUserId: owner.id, storeId: store.id });
      expect(summary).toMatchObject({ discovered: 1, draftsCreated: 1, existing: 0, failed: 0 });
      const [draft] = await db.select().from(products).where(and(eq(products.storeId, store.id), eq(products.productCode, productCode))).limit(1);
      expect(draft).toMatchObject({ productCode, status: "draft", category: "ربطات", name: `منتج يحتاج بيانات — ${productCode}` });
      productId = draft!.id;
      const media = await db.select().from(productMedia).where(eq(productMedia.productId, productId));
      expect(media).toEqual(expect.arrayContaining([expect.objectContaining({ source: "onedrive", mediaType: "image", originalFileName: "front.webp", originalUrl: "https://onedrive.test/front.webp" })]));
      const [folder] = await db.select().from(catalogFolderImports).where(eq(catalogFolderImports.linkedProductId, productId)).limit(1);
      expect(JSON.parse(folder!.missingFields ?? "[]")).toEqual(expect.arrayContaining(["product.txt"]));
      expect(JSON.parse(folder!.missingFields ?? "[]")).not.toContain("images");
    } finally {
      if (productId) {
        await db.delete(productOperations).where(eq(productOperations.productId, productId));
        await db.delete(productMedia).where(eq(productMedia.productId, productId));
        await db.delete(productImportJobs).where(eq(productImportJobs.linkedProductId, productId));
        await db.delete(catalogFolderImports).where(eq(catalogFolderImports.linkedProductId, productId));
        await db.delete(products).where(eq(products.id, productId));
      }
      await db.delete(catalogGroupImports).where(eq(catalogGroupImports.groupFolderId, groupId));
    }
  }, 15_000);

  it("يستخدم اسم المجلد Code وينشئ مسودة مكتملة البيانات والوسائط", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار مسودة المنتج المكتمل.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    const store = await getPublicStore();
    if (!owner || !store) throw new Error("لا توجد بيانات تشغيلية لاختبار مسودة المنتج المكتمل.");
    const productCode = `TST-FULL-${randomUUID().slice(0, 10)}`;
    const groupId = `group-${productCode}`;
    const folderId = `folder-${productCode}`;
    let productId: number | null = null;
    catalogMocks.getConnection.mockResolvedValue({ status: "catalog_selected", selectedDriveId: "drive-test", selectedFolderId: "catalog-root", encryptedAccessToken: "encrypted-test-token" });
    catalogMocks.readTextFile.mockResolvedValue("PRODUCT_NAME_AR: حجاب مستورد\nSELLING_PRICE_IQD: 15000\nDESCRIPTION_AR: وصف مستورد\nSIZES:\nPRODUCT_STATUS: draft");
    catalogMocks.listChildren.mockImplementation(async ({ folderId: requestedFolderId }: { folderId: string }) => {
      if (requestedFolderId === "catalog-root") return [{ id: groupId, name: "حجابات", kind: "folder" }];
      if (requestedFolderId === groupId) return [{ id: folderId, name: productCode, kind: "folder" }];
      if (requestedFolderId === folderId) return [
        { id: "metadata", name: "product.txt", kind: "file", webUrl: null },
        { id: "image", name: "front.jpg", kind: "file", webUrl: "https://onedrive.test/front.jpg" },
      ];
      return [];
    });
    try {
      const summary = await scanCatalogForOwner({ ownerUserId: owner.id, storeId: store.id });
      expect(summary).toMatchObject({ discovered: 1, draftsCreated: 1, existing: 0, failed: 0 });
      const [draft] = await db.select().from(products).where(and(eq(products.storeId, store.id), eq(products.productCode, productCode))).limit(1);
      expect(draft).toMatchObject({ productCode, name: "حجاب مستورد", category: "حجابات", description: "وصف مستورد", sellingPrice: "15000.00", status: "draft" });
      productId = draft!.id;
      const [folder] = await db.select().from(catalogFolderImports).where(eq(catalogFolderImports.linkedProductId, productId)).limit(1);
      expect(JSON.parse(folder!.missingFields ?? "[]")).toEqual([]);
    } finally {
      if (productId) {
        await db.delete(productOperations).where(eq(productOperations.productId, productId));
        await db.delete(productMedia).where(eq(productMedia.productId, productId));
        await db.delete(productImportJobs).where(eq(productImportJobs.linkedProductId, productId));
        await db.delete(catalogFolderImports).where(eq(catalogFolderImports.linkedProductId, productId));
        await db.delete(products).where(eq(products.id, productId));
      }
      await db.delete(catalogGroupImports).where(eq(catalogGroupImports.groupFolderId, groupId));
    }
  }, 15_000);

  it("يحافظ على المنتج عند rename/move أو disappearance ويرسل إشعار مراجعة واحدًا لكل كيان", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار reconciliation.");
    const [owner] = await db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم لاختبار reconciliation.");
    const store = await getPublicStore();
    if (!store) throw new Error("لا يوجد متجر لاختبار reconciliation.");
    const productCode = `TST-RECON-${randomUUID().slice(0, 8)}`;
    const productResult = await db.insert(products).values({ storeId: store.id, productCode, name: "منتج reconciliation", category: "مجموعة قديمة", status: "ready", sellingPrice: "9000", createdByUserId: owner.id });
    const productId = Number(productResult[0].insertId);
    const groupFolderId = `group-recon-${productCode}`;
    const productFolderId = `folder-recon-${productCode}`;
    await db.insert(catalogGroupImports).values({ storeId: store.id, ownerUserId: owner.id, groupFolderId, groupName: "مجموعة قديمة", sourceReference: "Catalog/مجموعة قديمة", state: "discovered" });
    await db.insert(catalogFolderImports).values({ storeId: store.id, ownerUserId: owner.id, productFolderId, groupName: "مجموعة قديمة", productCode: "HJB-OLD-CODE", sourceReference: "Catalog/مجموعة قديمة/HJB-OLD-CODE", state: "already_exists", linkedProductId: productId, imageCount: 0 });
    catalogMocks.getConnection.mockResolvedValue({ status: "catalog_selected", selectedDriveId: "drive-test", selectedFolderId: "catalog-root", encryptedAccessToken: "encrypted-test-token" });
    catalogMocks.listChildren.mockImplementation(async ({ folderId }: { folderId: string }) => {
      if (folderId === "catalog-root") return [{ id: groupFolderId, name: "مجموعة جديدة", kind: "folder" }];
      if (folderId === groupFolderId) return [{ id: productFolderId, name: "HJB-NEW-CODE", kind: "folder" }];
      if (folderId === productFolderId) return [];
      return [];
    });
    try {
      await scanCatalogForOwner({ ownerUserId: owner.id, storeId: store.id });
      const [group] = await db.select().from(catalogGroupImports).where(and(eq(catalogGroupImports.storeId, store.id), eq(catalogGroupImports.groupFolderId, groupFolderId))).limit(1);
      const [folder] = await db.select().from(catalogFolderImports).where(and(eq(catalogFolderImports.storeId, store.id), eq(catalogFolderImports.productFolderId, productFolderId))).limit(1);
      const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      expect(group).toMatchObject({ groupName: "مجموعة جديدة", state: "needs_review", lastError: "source_group_identity_changed" });
      expect(folder).toMatchObject({ productCode: "HJB-NEW-CODE", groupName: "مجموعة جديدة", state: "needs_review", lastError: "source_folder_identity_changed", linkedProductId: productId });
      expect(product).toMatchObject({ id: productId, productCode, status: "ready" });
      expect(catalogMocks.notifyPermissionHolders).toHaveBeenCalledWith(expect.objectContaining({ entityType: "catalog_group", route: "/products?catalogReview=groups" }));
      expect(catalogMocks.notifyPermissionHolders).toHaveBeenCalledWith(expect.objectContaining({ entityType: "catalog_folder", route: "/products?catalogReview=folders" }));
    } finally {
      await db.delete(catalogFolderImports).where(eq(catalogFolderImports.productFolderId, productFolderId));
      await db.delete(catalogGroupImports).where(eq(catalogGroupImports.groupFolderId, groupFolderId));
      await db.delete(products).where(eq(products.id, productId));
    }
  }, 15_000);
});
