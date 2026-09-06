import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProductWithVariants: vi.fn(),
  getProductMedia: vi.fn(),
  getCatalogProductFolderId: vi.fn(),
  saveOperationalMediaCopy: vi.fn(),
  getUsableCatalogConnection: vi.fn(),
  listCatalogChildren: vi.fn(),
  readCatalogOriginalImageBytes: vi.fn(),
  createOperationalImageDerivative: vi.fn(),
  storagePut: vi.fn(),
}));

vi.mock("./db", () => ({
  getProductWithVariants: mocks.getProductWithVariants,
  getProductMedia: mocks.getProductMedia,
  getCatalogProductFolderId: mocks.getCatalogProductFolderId,
  saveOperationalMediaCopy: mocks.saveOperationalMediaCopy,
}));
vi.mock("../integrations/onedrive/catalogAuth", () => ({ getUsableCatalogConnection: mocks.getUsableCatalogConnection }));
vi.mock("../integrations/onedrive/catalog", () => ({
  listCatalogChildren: mocks.listCatalogChildren,
  readCatalogOriginalImageBytes: mocks.readCatalogOriginalImageBytes,
}));
vi.mock("../integrations/onedrive/operationalMedia", () => ({ createOperationalImageDerivative: mocks.createOperationalImageDerivative }));
vi.mock("../storage", () => ({ storagePut: mocks.storagePut }));

import { regenerateOperationalMediaForProduct } from "./operationalMediaService";

describe("خدمة إعادة توليد WebP", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getProductWithVariants.mockResolvedValue({
      product: { id: 44, category: "الحجابات", productCode: "HJB-REGEN-001" },
      variants: [],
    });
    mocks.getProductMedia.mockResolvedValue([{
      id: 91,
      productId: 44,
      variantId: 12,
      source: "onedrive",
      mediaType: "image",
      originalFileName: "wine.jpg",
      storageKey: "products/44/operational/12/91-old.webp",
    }]);
    mocks.getCatalogProductFolderId.mockResolvedValue("product-1");
    mocks.getUsableCatalogConnection.mockResolvedValue({
      selectedDriveId: "drive-1",
      selectedFolderId: "catalog-1",
      encryptedAccessToken: "encrypted-token",
    });
    mocks.listCatalogChildren.mockImplementation(async ({ folderId }: { folderId: string }) => {
      if (folderId === "product-1") return [{ id: "file-1", kind: "file", name: "wine.jpg" }];
      return [{ id: "file-1", kind: "file", name: "wine.jpg" }];
    });
    mocks.readCatalogOriginalImageBytes.mockResolvedValue({ bytes: Buffer.from("original"), mimeType: "image/jpeg" });
    mocks.createOperationalImageDerivative.mockResolvedValue({
      bytes: Buffer.from("webp"),
      metadata: { format: "webp", outputBytes: 4, width: 1, height: 1, quality: 82 },
    });
    mocks.storagePut.mockResolvedValue({ key: "products/44/operational/12/91-new.webp", url: "/manus-storage/ignored" });
  });

  it("يعيد إنشاء نسخة محددة من مصدر مقروء فقط ويسجلها كإعادة توليد", async () => {
    const result = await regenerateOperationalMediaForProduct({ userId: 7, productId: 44, mediaId: 91 });

    expect(mocks.readCatalogOriginalImageBytes).toHaveBeenCalledWith({ encryptedAccessToken: "encrypted-token", driveId: "drive-1", fileId: "file-1" });
    expect(mocks.storagePut).toHaveBeenCalledWith("products/44/operational/12/91.webp", expect.any(Buffer), "image/webp");
    expect(mocks.saveOperationalMediaCopy).toHaveBeenCalledWith(expect.objectContaining({
      mediaId: 91,
      storageKey: "products/44/operational/12/91-new.webp",
      createdByUserId: 7,
      lifecycleAction: "operational_copy_regenerated",
    }));
    expect(result).toMatchObject({ created: [{ mediaId: 91, storageKey: "products/44/operational/12/91-new.webp", outputBytes: 4 }] });
  });
});
