import { readFileSync, writeFileSync } from "node:fs";

function replaceConflict(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  if (start === -1) return source;
  const end = source.indexOf(endMarker, start);
  if (end === -1) throw new Error(`Missing conflict end: ${endMarker}`);
  return source.slice(0, start) + replacement + source.slice(end + endMarker.length);
}

let page = readFileSync("client/src/pages/Products.tsx", "utf8");
page = replaceConflict(page, "<<<<<<< HEAD\nfunction operationActionLabel", ">>>>>>> a8449cc (Add product archive, restore, and completion score UI)", `function operationActionLabel(action: string) { return ({ details_updated: "تعديل بيانات", inventory_saved: "حفظ المخزون", color_inventory_saved: "حفظ مخزون اللون", color_added: "إضافة لون", color_renamed: "تعديل اسم لون", media_color_assigned: "ربط صورة بلون", media_color_review_excluded: "استبعاد صورة من مراجعة اللون", media_color_review_restored: "إعادة صورة للمراجعة", primary_media_changed: "تغيير الصورة الأساسية", onedrive_manual_edit_conflict: "تعارض مع تعديل يدوي", product_archived: "أرشفة المنتج", product_restored_from_archive: "استعادة من الأرشيف", product_activated: "تنشيط المنتج", review_readiness_updated: "تحديث الجهوزية", media_uploaded: "إضافة صورة", color_suggestions_generated: "اقتراح ألوان", color_suggestions_reviewed: "مراجعة اقتراحات الألوان" } as Record<string, string>)[action] ?? action; }
function productCompletion(product: { name: string; description?: string | null; sellingPrice: string; primaryImageUrl?: string | null; missingFields: string[]; variants: Array<{ inventoryQuantity: number }> }) {
  const checks = [Boolean(product.name.trim()), Boolean(product.description?.trim()), Number(product.sellingPrice) > 0, Boolean(product.primaryImageUrl), product.variants.length > 0, product.variants.length > 0 && product.variants.every(variant => Number.isFinite(variant.inventoryQuantity) && variant.inventoryQuantity >= 0)];
  const completed = checks.filter(Boolean).length;
  return { completed, total: checks.length, percent: Math.round((completed / checks.length) * 100), variantCount: product.variants.length, inventoryTotal: product.variants.reduce((sum, variant) => sum + variant.inventoryQuantity, 0) };
}
`);
page = replaceConflict(page, "<<<<<<< HEAD\n  const workCounts", ">>>>>>> a8449cc (Add product archive, restore, and completion score UI)", `  useEffect(() => {
    if (!sourceUpdate.data) {
      setSourceDecisions({});
      return;
    }
    setSourceDecisions(Object.fromEntries(sourceUpdate.data.changes.map(change => [\`${change.kind}:${change.label}\`, "platform" as const])));
  }, [sourceUpdate.data?.id]);

  const workCounts = useMemo(() => ({ needs_work: products.data?.filter(product => product.status !== "active" && product.status !== "archived" && product.missingFields.length > 0).length ?? 0, draft: products.data?.filter(product => product.status === "draft").length ?? 0, ready: products.data?.filter(product => ["ready", "needs_review"].includes(product.status)).length ?? 0, active: products.data?.filter(product => product.status === "active").length ?? 0, workspace: products.data?.filter(product => !["active", "archived"].includes(product.status)).length ?? 0, archived: products.data?.filter(product => product.status === "archived").length ?? 0 }), [products.data]);
`);
// For the large render conflict, retain the cherry-picked feature-rich UI.
page = replaceConflict(page, "<<<<<<< HEAD\n    <section className={selectedProductId", ">>>>>>> a8449cc (Add product archive, restore, and completion score UI)", page.slice(page.indexOf("=======", page.indexOf("<<<<<<< HEAD\n    <section className={selectedProductId")) + "=======\n".length, page.indexOf(">>>>>>> a8449cc (Add product archive, restore, and completion score UI)", page.indexOf("<<<<<<< HEAD\n    <section className={selectedProductId"))));
writeFileSync("client/src/pages/Products.tsx", page);

let router = readFileSync("server/routers/products.ts", "utf8");
router = replaceConflict(router, "<<<<<<< HEAD\nimport { activateReadyProduct", ">>>>>>> a8449cc (Add product archive, restore, and completion score UI)", 'import { activateReadyProduct, archiveProduct, addManualProductImage, addProductColor, applyAutomaticColorSuggestionReview, assignProductMediaColor, createImportJob, createProduct, deleteProductColor, detachProductMediaReference, excludeProductMediaFromColorReview, generateAutomaticColorSuggestion, getCatalogProductFolderId, getProductForVariantInStore, getProductMedia, getProductWithVariants, getPublicStoreProduct, listImportJobs, listProductOperations, listProductsWithPrimaryOperationalMedia, listProductsWithPrimaryOperationalMedia, listPublicProducts, permanentlyDeleteProduct, recordAutomaticColorSuggestionDecision, refreshProductReviewStatus, renameProductColor, restoreArchivedProduct, restoreProductMediaToColorReview, saveProductColorInventory, saveProductInventory, setPrimaryProductMedia, updateProductDetails, updateVariantInventory } from "../products/db";');
router = router.replace("listProductsWithPrimaryOperationalMedia, listProductsWithPrimaryOperationalMedia,", "listProductsWithPrimaryOperationalMedia,");
writeFileSync("server/routers/products.ts", router);

let test = readFileSync("server/routers/products.operations.contract.test.ts", "utf8");
test = replaceConflict(test, "<<<<<<< HEAD\n", ">>>>>>> a8449cc (Add product archive, restore, and completion score UI)", `    expect(routerSource).toContain("restoreFromArchive");
    expect(routerSource).toContain("archive: protectedProcedure");
    expect(dbSource).toContain("product_archived");
    expect(dbSource).toContain("product_restored_from_archive");
`);
writeFileSync("server/routers/products.operations.contract.test.ts", test);
