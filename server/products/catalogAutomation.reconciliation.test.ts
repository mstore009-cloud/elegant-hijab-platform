import { describe, expect, it } from "vitest";
import { buildCatalogFolderReviewNotification, classifyCatalogFolderObservation, classifyCatalogGroupObservation } from "./catalogAutomation";

describe("Catalog reconciliation classification", () => {
  it("flags a new top-level group for review", () => {
    expect(classifyCatalogGroupObservation(undefined, "مجموعة صيفية")).toEqual({
      renamed: false,
      state: "needs_review",
      lastError: null,
    });
  });

  it("preserves an approved group observation until its identity changes", () => {
    expect(classifyCatalogGroupObservation({ state: "discovered", groupName: "مجموعة صيفية" }, "مجموعة صيفية")).toEqual({
      renamed: false,
      state: "discovered",
      lastError: null,
    });
    expect(classifyCatalogGroupObservation({ state: "discovered", groupName: "مجموعة صيفية" }, "مجموعة خريفية")).toEqual({
      renamed: true,
      state: "needs_review",
      lastError: "source_group_identity_changed",
    });
  });

  it("marks a product folder rename or move for review without changing the product", () => {
    expect(classifyCatalogFolderObservation({ productCode: "HJB-001", groupName: "مجموعة صيفية" }, "مجموعة خريفية", "HJB-001")).toEqual({
      changed: true,
      lastError: "source_folder_identity_changed",
    });
    expect(classifyCatalogFolderObservation({ productCode: "HJB-001", groupName: "مجموعة صيفية" }, "مجموعة صيفية", "HJB-002")).toEqual({
      changed: true,
      lastError: "source_folder_identity_changed",
    });
    expect(buildCatalogFolderReviewNotification({ storeId: 7, entityId: 44, folderId: "folder-44", folderName: "HJB-002", groupName: "مجموعة خريفية" })).toMatchObject({
      permissionCode: "products.create",
      type: "content_review_requested",
      entityType: "catalog_folder",
      entityId: 44,
      route: "/products?catalogReview=folders",
      dedupeKey: "catalog-folder-identity-change:7:folder-44:HJB-002:مجموعة خريفية",
    });
  });
});
