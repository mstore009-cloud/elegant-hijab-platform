import { describe, expect, it } from "vitest";
import { flattenCategoryNodes, inspectCatalogTree } from "./catalogTree";

describe("تحليل شجرة Catalog من OneDrive", () => {
  it("يميّز التصنيفات المتداخلة عن مجلد المنتج الذي يضم معلومات ووسائط، ويبلغ عن المجلد الناقص", async () => {
    const tree = new Map([
      ["root", [
        { id: "hijab", name: "حجابات جاهزة", kind: "folder" as const, webUrl: null, size: null },
        { id: "ties", name: "ربطات", kind: "folder" as const, webUrl: null, size: null },
      ]],
      ["hijab", [
        { id: "princess", name: "حجاب الأميرة", kind: "folder" as const, webUrl: null, size: null },
        { id: "incomplete", name: "حجاب غير مكتمل", kind: "folder" as const, webUrl: null, size: null },
      ]],
      ["ties", [
        { id: "cotton", name: "ربطات قطن", kind: "folder" as const, webUrl: null, size: null },
      ]],
      ["cotton", [
        { id: "turkish", name: "ربطة قطن تركي متر", kind: "folder" as const, webUrl: null, size: null },
      ]],
      ["princess", [
        { id: "meta-1", name: "product.docx", kind: "file" as const, webUrl: null, size: 100 },
        { id: "image-1", name: "front.jpg", kind: "file" as const, webUrl: null, size: 100 },
        { id: "video-1", name: "show.mp4", kind: "file" as const, webUrl: null, size: 100 },
      ]],
      ["incomplete", [
        { id: "meta-2", name: "product.txt", kind: "file" as const, webUrl: null, size: 100 },
      ]],
      ["turkish", [
        { id: "meta-3", name: "product.txt", kind: "file" as const, webUrl: null, size: 100 },
        { id: "image-2", name: "front.webp", kind: "file" as const, webUrl: null, size: 100 },
      ]],
    ]);

    const result = await inspectCatalogTree({
      rootFolderId: "root",
      rootFolderName: "Catalog",
      listChildren: async folderId => tree.get(folderId) ?? [],
    });

    expect(result.summary).toMatchObject({ categories: 4, products: 2, needsReview: 1, scannedFolders: 7 });
    expect(result.root.children[0]).toMatchObject({ name: "حجابات جاهزة", kind: "category" });
    expect(result.root.children[0]?.children[0]).toMatchObject({ name: "حجاب الأميرة", kind: "product", mediaFileCount: 2 });
    expect(result.root.children[0]?.children[1]).toMatchObject({ name: "حجاب غير مكتمل", kind: "needs_review" });
    expect(flattenCategoryNodes(result.root).map(item => item.path)).toEqual(["Catalog/حجابات جاهزة", "Catalog/ربطات", "Catalog/ربطات/ربطات قطن"]);
  });
});
