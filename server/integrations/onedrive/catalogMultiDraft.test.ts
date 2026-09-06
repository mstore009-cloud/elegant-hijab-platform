import { describe, expect, it, vi } from "vitest";
import { createSelectedCatalogDrafts, previewCatalogGroupProducts } from "./catalogMultiDraft";

describe("معاينة Catalog متعددة المنتجات", () => {
  it("تعزل أخطاء كل مجلد وتسمح بالاختيار فقط للبيانات الصالحة وغير المكررة", async () => {
    const readFolderContents = vi.fn(async (folderId: string) => {
      if (folderId === "valid") return [{ id: "meta-valid", name: "product.txt", kind: "file" as const, webUrl: null, size: 1 }, { id: "img", name: "01.jpg", kind: "file" as const, webUrl: null, size: 1 }];
      if (folderId === "existing") return [{ id: "meta-existing", name: "product.txt", kind: "file" as const, webUrl: null, size: 1 }];
      return [{ id: "img-bad", name: "01.jpg", kind: "file" as const, webUrl: null, size: 1 }];
    });
    const readMetadataText = vi.fn(async (fileId: string) => fileId === "meta-valid"
      ? "PRODUCT_NAME_AR: حجاب صالح\nSELLING_PRICE_IQD: 8000\nDESCRIPTION_AR: وصف\nSIZES:\nPRODUCT_STATUS: draft"
      : "PRODUCT_NAME_AR: حجاب موجود\nSELLING_PRICE_IQD: 9000\nDESCRIPTION_AR: وصف\nSIZES: M\nPRODUCT_STATUS: draft");

    const entries = await previewCatalogGroupProducts({
      groupName: "الحجابات",
      productFolders: [
        { id: "valid", name: "HJB-100", kind: "folder", webUrl: null, size: null },
        { id: "existing", name: "HJB-101", kind: "folder", webUrl: null, size: null },
        { id: "invalid", name: "HJB-102", kind: "folder", webUrl: null, size: null },
      ],
      existingProductCodes: new Set(["HJB-101"]),
      readFolderContents,
      readMetadataText,
    });

    expect(entries.map(entry => [entry.productCode, entry.state, entry.selectable])).toEqual([
      ["HJB-100", "ready", true],
      ["HJB-101", "already_exists", false],
      ["HJB-102", "invalid", false],
    ]);
    expect(entries[0]).toMatchObject({ imageCount: 1, sourceReference: "Catalog/الحجابات/HJB-100" });
    expect(entries[2]?.problems[0]).toContain("product.txt");
  });

  it("يقبل product.docx ويحتفظ بالسعر السابق في metadata المعروضة", async () => {
    const entries = await previewCatalogGroupProducts({
      groupName: "حجابات",
      productFolders: [{ id: "folder-1", name: "HJB-DOCX-001", kind: "folder", webUrl: null, size: null }],
      existingProductCodes: new Set(),
      readFolderContents: async () => [
        { id: "docx-1", name: "product.docx", kind: "file", webUrl: null, size: 2000 },
        { id: "img-1", name: "front.jpg", kind: "file", webUrl: null, size: 1000 },
      ],
      readMetadataText: async () => { throw new Error("لا يجب قراءة product.txt عند توفر docx"); },
      readMetadataDocx: async () => ({ name: "حجاب Word", sellingPrice: "12000", previousPrice: "15000", description: "وصف", sizes: ["Medium", "Large"], status: "draft" }),
    });
    expect(entries[0]).toMatchObject({ state: "ready", selectable: true, imageCount: 1 });
    expect(entries[0]?.metadata).toMatchObject({ name: "حجاب Word", sellingPrice: "12000", previousPrice: "15000", sizes: ["Medium", "Large"] });
  });

  it("ينشئ فقط الاختيارات الصالحة ولا يستدعي الإنشاء للمجلد الموجود أو غير الصالح", async () => {
    const createDraft = vi.fn(async () => ({ created: true }));
    const entries = [
      { productFolderId: "ready", productCode: "HJB-200", state: "ready" as const, selectable: true, sourceReference: "Catalog/الحجابات/HJB-200", metadata: { name: "حجاب", sellingPrice: "8000", previousPrice: null, description: "وصف", sizes: [] }, imageCount: 1, documentCount: 0, problems: [] },
      { productFolderId: "exists", productCode: "HJB-201", state: "already_exists" as const, selectable: false, sourceReference: "Catalog/الحجابات/HJB-201", metadata: null, imageCount: 1, documentCount: 0, problems: ["موجود مسبقًا"] },
      { productFolderId: "invalid", productCode: "HJB-202", state: "invalid" as const, selectable: false, sourceReference: "Catalog/الحجابات/HJB-202", metadata: null, imageCount: 0, documentCount: 0, problems: ["product.txt غير موجود"] },
    ];

    const result = await createSelectedCatalogDrafts({ entries, selectedFolderIds: ["ready", "exists", "invalid", "unknown"], createDraft });

    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ productFolderId: "ready", metadata: expect.objectContaining({ description: "وصف" }) }));
    expect(result.map(entry => [entry.productCode, entry.state])).toEqual([
      ["HJB-200", "created"],
      ["HJB-201", "already_exists"],
      ["HJB-202", "rejected"],
      ["غير معروف", "rejected"],
    ]);
  });
});
