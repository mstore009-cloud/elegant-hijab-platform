import { and, desc, eq } from "drizzle-orm";
import { catalogFolderImports, productImportJobs, productMedia, productMediaLifecycleEvents, productOperations, productVariants, products } from "../../drizzle/schema";
import { normalizeApprovedColorNames, validateApprovedImageColorLinks } from "../integrations/onedrive/productMetadata";
import { getDb } from "../db";
import { planOperationalReferenceDetach } from "./operationalMediaLifecycle";
import { createOperationalImageDerivative } from "../integrations/onedrive/operationalMedia";
import { analyzeStoredProductColors, type ProductColorSuggestion } from "./colorAnalysis";
import { storagePut } from "../storage";

export async function listProducts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(products).orderBy(desc(products.updatedAt));
}

export async function listProductsWithPrimaryOperationalMedia() {
  const db = await getDb();
  if (!db) return [];
  const [productList, mediaList, folderImports] = await Promise.all([
    db.select().from(products).orderBy(desc(products.updatedAt)),
    db.select().from(productMedia).orderBy(productMedia.sortOrder),
    db.select().from(catalogFolderImports),
  ]);
  const primaryMediaByProductId = new Map<number, typeof mediaList[number]>();
  const unconfirmedMediaByProductId = new Map<number, number>();
  for (const media of mediaList) {
    if (!media.storageKey || primaryMediaByProductId.has(media.productId)) continue;
    primaryMediaByProductId.set(media.productId, media);
  }
  for (const media of mediaList) {
    if (media.mediaType === "image" && !media.variantId && !media.colorVerified) {
      unconfirmedMediaByProductId.set(media.productId, (unconfirmedMediaByProductId.get(media.productId) ?? 0) + 1);
    }
  }
  const missingByProductId = new Map(folderImports.filter(entry => entry.linkedProductId).map(entry => [entry.linkedProductId!, parseMissingFields(entry.missingFields)]));
  return productList.map(product => {
    const missingFields = [...(missingByProductId.get(product.id) ?? [])];
    if ((unconfirmedMediaByProductId.get(product.id) ?? 0) > 0 && !missingFields.includes("imageColorReview")) missingFields.push("imageColorReview");
    return { product, primaryMedia: primaryMediaByProductId.get(product.id) ?? null, missingFields };
  });
}

export function parseMissingFields(value: string | null) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((field): field is string => typeof field === "string") : [];
  } catch {
    return [];
  }
}

export function isPublicProductStatus(status: string) {
  return status === "active";
}

export async function listPublicProducts() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      productCode: products.productCode,
      name: products.name,
      category: products.category,
      description: products.description,
      sellingPrice: products.sellingPrice,
    })
    .from(products)
    .where(eq(products.status, "active"))
    .orderBy(desc(products.updatedAt));
}

export async function getProductWithVariants(productId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!result[0]) return null;
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
  const media = await db.select().from(productMedia).where(eq(productMedia.productId, productId));
  const [folderImport] = await db.select().from(catalogFolderImports).where(eq(catalogFolderImports.linkedProductId, productId)).limit(1);
  const missingFields = parseMissingFields(folderImport?.missingFields ?? null);
  if (media.some(item => item.mediaType === "image" && !item.variantId && !item.colorVerified) && !missingFields.includes("imageColorReview")) missingFields.push("imageColorReview");
  const operations = await db.select().from(productOperations).where(eq(productOperations.productId, productId)).orderBy(desc(productOperations.createdAt));
  const generated = operations.find(operation => operation.action === "color_suggestions_generated");
  const reviewed = generated ? operations.some(operation => operation.action === "color_suggestions_reviewed" && (() => {
    try { return JSON.parse(operation.changes).suggestionOperationId === generated.id; } catch { return false; }
  })()) : false;
  let pendingColorSuggestion: { operationId: number; suggestion: ProductColorSuggestion } | null = null;
  if (generated && !reviewed) {
    try {
      const suggestion = JSON.parse(generated.changes).suggestion as ProductColorSuggestion;
      if (suggestion && Array.isArray(suggestion.colorGroups)) pendingColorSuggestion = { operationId: generated.id, suggestion };
    } catch { /* ignore malformed historical log */ }
  }
  return { product: result[0], variants, missingFields, pendingColorSuggestion };
}

export async function generateAutomaticColorSuggestion(input: { productId: number; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [product] = await db.select().from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product) throw new Error("المنتج غير موجود.");
  const media = await db.select().from(productMedia).where(eq(productMedia.productId, input.productId));
  const suggestion = await analyzeStoredProductColors({ productCode: product.productCode, media });
  const inserted = await db.insert(productOperations).values({
    productId: input.productId,
    actorUserId: input.actorUserId,
    source: "catalog_scan",
    action: "color_suggestions_generated",
    changes: JSON.stringify({ suggestion }),
  });
  return { operationId: Number(inserted[0].insertId), suggestion };
}

export async function recordAutomaticColorSuggestionDecision(input: { productId: number; suggestionOperationId: number; decision: "accepted" | "rejected"; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.insert(productOperations).values({
    productId: input.productId,
    actorUserId: input.actorUserId,
    source: "products_ui",
    action: "color_suggestions_reviewed",
    changes: JSON.stringify({ suggestionOperationId: input.suggestionOperationId, decision: input.decision }),
  });
  return { success: true };
}

export async function updateProductDetails(input: {
  productId: number;
  name?: string;
  description?: string | null;
  sellingPrice?: string;
  sizeLabels?: string[];
  status?: "draft" | "needs_review" | "ready" | "archived";
  actorUserId: number;
  source: "products_ui" | "whatsapp";
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [product] = await db.select().from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product) throw new Error("المنتج غير موجود.");
  const [folderImport] = await db.select().from(catalogFolderImports).where(eq(catalogFolderImports.linkedProductId, input.productId)).limit(1);
  const priorMissing = parseMissingFields(folderImport?.missingFields ?? null);
  const nextMissing = new Set(priorMissing);
  const changes: Record<string, unknown> = {};
  const patch: Partial<typeof products.$inferInsert> = {};
  if (input.name !== undefined) {
    patch.name = input.name;
    changes.name = input.name;
    if (input.name.trim()) nextMissing.delete("name");
  }
  if (input.description !== undefined) {
    patch.description = input.description;
    changes.descriptionUpdated = true;
    if (input.description?.trim()) nextMissing.delete("description");
    else nextMissing.add("description");
  }
  if (input.sellingPrice !== undefined) {
    patch.sellingPrice = input.sellingPrice;
    changes.sellingPrice = input.sellingPrice;
    if (Number(input.sellingPrice) > 0) nextMissing.delete("sellingPrice");
    else nextMissing.add("sellingPrice");
  }
  if (input.sizeLabels !== undefined) {
    patch.sizeLabels = JSON.stringify(input.sizeLabels);
    changes.sizeLabels = input.sizeLabels;
    nextMissing.delete("sizes");
  }
  if (input.status !== undefined) {
    patch.status = input.status;
    changes.status = input.status;
  }
  if (Object.keys(patch).length === 0) return { product, missingFields: Array.from(nextMissing) };
  await db.transaction(async tx => {
    await tx.update(products).set(patch).where(eq(products.id, input.productId));
    if (folderImport) await tx.update(catalogFolderImports).set({ missingFields: JSON.stringify(Array.from(nextMissing)), state: "needs_review" }).where(eq(catalogFolderImports.id, folderImport.id));
    await tx.insert(productOperations).values({ productId: input.productId, actorUserId: input.actorUserId, source: input.source, action: "details_updated", changes: JSON.stringify(changes) });
  });
  const [updated] = await db.select().from(products).where(eq(products.id, input.productId)).limit(1);
  return { product: updated!, missingFields: Array.from(nextMissing) };
}

function parseProductSizeLabels(value: string | null) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((size): size is string => typeof size === "string" && size.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

async function removeCatalogMissingField(productId: number, field: string) {
  const db = await getDb();
  if (!db) return;
  const [folderImport] = await db.select().from(catalogFolderImports).where(eq(catalogFolderImports.linkedProductId, productId)).limit(1);
  if (!folderImport) return;
  const nextMissing = parseMissingFields(folderImport.missingFields).filter(item => item !== field);
  await db.update(catalogFolderImports).set({ missingFields: JSON.stringify(nextMissing), state: "needs_review" }).where(eq(catalogFolderImports.id, folderImport.id));
}

export async function addProductColor(input: { productId: number; colorName: string; actorUserId: number; source?: "products_ui" | "whatsapp" }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [product] = await db.select().from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product) throw new Error("المنتج غير موجود.");
  const colorName = input.colorName.trim();
  if (!colorName) throw new Error("اسم اللون مطلوب.");
  const existing = await db.select().from(productVariants).where(and(eq(productVariants.productId, input.productId), eq(productVariants.colorName, colorName)));
  if (existing.length > 0) return { created: false as const, variants: existing };

  const sizes = parseProductSizeLabels(product.sizeLabels);
  const labels = sizes.length > 0 ? sizes : [""];
  const result = await db.transaction(async tx => {
    const current = await tx.select({ sortOrder: productVariants.sortOrder }).from(productVariants).where(eq(productVariants.productId, input.productId));
    await tx.insert(productVariants).values(labels.map((sizeLabel, index) => ({
      productId: input.productId,
      colorName,
      sizeLabel,
      inventoryQuantity: 0,
      availability: "out_of_stock" as const,
      sortOrder: current.length + index,
    })));
    await tx.insert(productOperations).values({
      productId: input.productId,
      actorUserId: input.actorUserId,
      source: input.source ?? "products_ui",
      action: "color_added",
      changes: JSON.stringify({ colorName, sizeLabels: labels }),
    });
    return tx.select().from(productVariants).where(and(eq(productVariants.productId, input.productId), eq(productVariants.colorName, colorName)));
  });
  await removeCatalogMissingField(input.productId, "colors");
  return { created: true as const, variants: result };
}

export async function assignProductMediaColor(input: { productId: number; mediaId: number; colorName: string; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [media] = await db.select().from(productMedia).where(and(eq(productMedia.id, input.mediaId), eq(productMedia.productId, input.productId))).limit(1);
  if (!media) throw new Error("الصورة غير موجودة لهذا المنتج.");
  const [variant] = await db.select().from(productVariants).where(and(eq(productVariants.productId, input.productId), eq(productVariants.colorName, input.colorName.trim()))).orderBy(productVariants.sortOrder).limit(1);
  if (!variant) throw new Error("أضف اللون أو اعتمده أولًا قبل ربط الصورة.");
  await db.transaction(async tx => {
    await tx.update(productMedia).set({ variantId: variant.id, colorVerified: true }).where(eq(productMedia.id, input.mediaId));
    await tx.insert(productOperations).values({
      productId: input.productId,
      actorUserId: input.actorUserId,
      source: "products_ui",
      action: "media_color_assigned",
      changes: JSON.stringify({ mediaId: input.mediaId, colorName: input.colorName.trim(), variantId: variant.id }),
    });
  });
  return { mediaId: input.mediaId, colorName: input.colorName.trim(), variantId: variant.id };
}

export async function excludeProductMediaFromColorReview(input: { productId: number; mediaIds: number[]; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const uniqueMediaIds = Array.from(new Set(input.mediaIds));
  if (uniqueMediaIds.length === 0) throw new Error("اختر صورة واحدة على الأقل لاستبعادها من مراجعة اللون.");
  const matching = await db.select().from(productMedia).where(eq(productMedia.productId, input.productId));
  const mediaById = new Map(matching.map(item => [item.id, item]));
  if (uniqueMediaIds.some(mediaId => !mediaById.has(mediaId))) throw new Error("تتضمن الصور المحددة صورة لا تنتمي إلى هذا المنتج.");
  if (uniqueMediaIds.some(mediaId => mediaById.get(mediaId)?.variantId)) throw new Error("لا يمكن استبعاد صورة مرتبطة بلون. افصل رابط اللون أولًا إن احتجت.");
  await db.transaction(async tx => {
    for (const mediaId of uniqueMediaIds) await tx.update(productMedia).set({ colorVerified: true }).where(eq(productMedia.id, mediaId));
    await tx.insert(productOperations).values({ productId: input.productId, actorUserId: input.actorUserId, source: "products_ui", action: "media_color_review_excluded", changes: JSON.stringify({ mediaIds: uniqueMediaIds }) });
  });
  return { excludedMediaIds: uniqueMediaIds };
}

export async function saveProductInventory(input: { productId: number; quantities: Array<{ variantId: number; inventoryQuantity: number }>; actorUserId: number; source?: "products_ui" | "whatsapp" }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, input.productId));
  if (variants.length === 0) throw new Error("أضف لونًا واحدًا على الأقل قبل إدخال المخزون.");
  const quantities = new Map(input.quantities.map(item => [item.variantId, item.inventoryQuantity]));
  if (quantities.size !== variants.length || variants.some(variant => !quantities.has(variant.id))) {
    throw new Error("أدخل كمية لكل لون أو تركيبة لون وقياس قبل الحفظ.");
  }
  await db.transaction(async tx => {
    for (const variant of variants) {
      const quantity = quantities.get(variant.id)!;
      if (!Number.isInteger(quantity) || quantity < 0) throw new Error("كمية المخزون يجب أن تكون رقمًا صحيحًا غير سالب.");
      const availability: "available" | "low_stock" | "out_of_stock" = quantity <= 0 ? "out_of_stock" : quantity <= 3 ? "low_stock" : "available";
      await tx.update(productVariants).set({ inventoryQuantity: quantity, availability }).where(eq(productVariants.id, variant.id));
    }
    await tx.insert(productOperations).values({
      productId: input.productId,
      actorUserId: input.actorUserId,
      source: input.source ?? "products_ui",
      action: "inventory_saved",
      changes: JSON.stringify({ quantities: input.quantities }),
    });
  });
  await removeCatalogMissingField(input.productId, "inventory");
  return { updatedVariantCount: variants.length };
}

export async function saveProductColorInventory(input: { productId: number; colorName: string; inventoryQuantity: number; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  if (!Number.isInteger(input.inventoryQuantity) || input.inventoryQuantity < 0) throw new Error("الكمية يجب أن تكون رقمًا صحيحًا غير سالب.");
  const variants = await db.select().from(productVariants).where(and(eq(productVariants.productId, input.productId), eq(productVariants.colorName, input.colorName)));
  if (variants.length === 0) throw new Error("لا يوجد لون معتمد بهذه التسمية.");
  const availability: "available" | "low_stock" | "out_of_stock" = input.inventoryQuantity <= 0 ? "out_of_stock" : input.inventoryQuantity <= 3 ? "low_stock" : "available";
  await db.transaction(async tx => {
    for (const variant of variants) await tx.update(productVariants).set({ inventoryQuantity: input.inventoryQuantity, availability }).where(eq(productVariants.id, variant.id));
    await tx.insert(productOperations).values({ productId: input.productId, actorUserId: input.actorUserId, source: "products_ui", action: "color_inventory_saved", changes: JSON.stringify({ colorName: input.colorName, inventoryQuantity: input.inventoryQuantity, variantIds: variants.map(variant => variant.id) }) });
  });
  await removeCatalogMissingField(input.productId, "inventory");
  return { updatedVariantCount: variants.length };
}

export async function addManualProductImage(input: { productId: number; fileName: string; bytes: Buffer; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [product] = await db.select().from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product) throw new Error("المنتج غير موجود.");
  const derivative = await createOperationalImageDerivative(input.bytes);
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-") || "image";
  const uploaded = await storagePut(`products/${input.productId}/manual/${Date.now()}-${safeName}.webp`, derivative.bytes, "image/webp");
  const existingMedia = await db.select({ id: productMedia.id }).from(productMedia).where(eq(productMedia.productId, input.productId));
  const result = await db.transaction(async tx => {
    const created = await tx.insert(productMedia).values({
      productId: input.productId,
      source: "manual",
      mediaType: "image",
      originalUrl: null,
      storageKey: uploaded.key,
      operationalMetadata: JSON.stringify({ ...derivative.metadata, source: "manual_product_upload" }),
      originalFileName: input.fileName,
      colorVerified: false,
      sortOrder: existingMedia.length,
    });
    const mediaId = Number(created[0].insertId);
    await tx.insert(productOperations).values({
      productId: input.productId,
      actorUserId: input.actorUserId,
      source: "products_ui",
      action: "manual_image_added",
      changes: JSON.stringify({ mediaId, fileName: input.fileName, format: "webp" }),
    });
    return mediaId;
  });
  return { mediaId: result, storageKey: uploaded.key, format: "webp" as const };
}

export async function getProductMedia(productId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productMedia).where(eq(productMedia.productId, productId)).orderBy(productMedia.sortOrder);
}

export async function createProduct(input: {
  productCode: string;
  name: string;
  category?: string;
  description?: string;
  status: "draft" | "needs_review" | "ready" | "active" | "archived";
  sellingPrice: string;
  costPrice?: string;
  targetMarginPercent?: string;
  createdByUserId: number;
  variants: Array<{ colorName: string; sizeLabel?: string; inventoryQuantity: number }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const result = await db.insert(products).values({
    productCode: input.productCode,
    name: input.name,
    category: input.category ?? null,
    description: input.description ?? null,
    status: input.status,
    sellingPrice: input.sellingPrice,
    costPrice: input.costPrice ?? null,
    targetMarginPercent: input.targetMarginPercent ?? null,
    createdByUserId: input.createdByUserId,
  });
  const productId = Number(result[0].insertId);
  if (input.variants.length > 0) {
    await db.insert(productVariants).values(input.variants.map((variant, index) => ({
      productId,
      colorName: variant.colorName,
      sizeLabel: variant.sizeLabel ?? "",
      inventoryQuantity: variant.inventoryQuantity,
      availability: (variant.inventoryQuantity > 0 ? "available" : "out_of_stock") as "available" | "out_of_stock",
      sortOrder: index,
    })));
  }
  return productId;
}

export async function createCatalogDraftProduct(input: {
  productCode: string;
  name: string;
  category: string;
  description: string;
  sellingPrice: string;
  sourceReference: string;
  createdByUserId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const existing = await db.select({ id: products.id }).from(products).where(eq(products.productCode, input.productCode)).limit(1);
  if (existing[0]) return { productId: existing[0].id, jobId: null, created: false };

  const productId = await createProduct({
    productCode: input.productCode,
    name: input.name,
    category: input.category,
    description: input.description,
    status: "draft",
    sellingPrice: input.sellingPrice,
    createdByUserId: input.createdByUserId,
    variants: [],
  });
  const job = await db.insert(productImportJobs).values({
    source: "onedrive",
    sourceReference: input.sourceReference,
    status: "needs_review",
    linkedProductId: productId,
    missingFields: "الألوان والمخزون والوسائط لم تُنشأ بعد؛ يلزم مراجعة المسودة.",
    createdByUserId: input.createdByUserId,
  });
  return { productId, jobId: Number(job[0].insertId), created: true };
}

export async function createApprovedCatalogColorVariants(input: {
  productCode: string;
  colorNames: string[];
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const product = await db.select().from(products).where(eq(products.productCode, input.productCode)).limit(1);
  if (!product[0]) throw new Error("مسودة المنتج غير موجودة.");
  if (product[0].status !== "draft") throw new Error("لا يمكن إضافة ألوان بهذه التجربة إلا إلى منتج في حالة مسودة.");

  const approvedColors = normalizeApprovedColorNames(input.colorNames);
  const existingVariants = await db.select().from(productVariants).where(eq(productVariants.productId, product[0].id));
  const existingColorKeys = new Set(existingVariants.map(variant => variant.colorName.toLocaleLowerCase("ar")));
  const newColors = approvedColors.filter(color => !existingColorKeys.has(color.toLocaleLowerCase("ar")));
  if (newColors.length > 0) {
    await db.insert(productVariants).values(newColors.map((colorName, index) => ({
      productId: product[0].id,
      colorName,
      sizeLabel: "",
      inventoryQuantity: 0,
      availability: "out_of_stock" as const,
      sortOrder: existingVariants.length + index,
    })));
  }
  return {
    productId: product[0].id,
    productCode: product[0].productCode,
    createdColorNames: newColors,
    existingColorNames: approvedColors.filter(color => !newColors.includes(color)),
    inventoryQuantity: 0,
    mediaCount: 0,
  };
}

export async function attachApprovedCatalogImageReferences(input: {
  productCode: string;
  links: Array<{ colorName: string; imageFileName: string; originalUrl: string | null }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const product = await db.select().from(products).where(eq(products.productCode, input.productCode)).limit(1);
  if (!product[0]) throw new Error("مسودة المنتج غير موجودة.");
  if (product[0].status !== "draft") throw new Error("لا يمكن ربط مراجع الصور بهذه التجربة إلا بمنتج في حالة مسودة.");
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, product[0].id));
  const validatedLinks = validateApprovedImageColorLinks({
    approvedColorNames: variants.map(variant => variant.colorName),
    availableImageFileNames: input.links.map(link => link.imageFileName),
    links: input.links,
  });
  const variantByColor = new Map(variants.map(variant => [variant.colorName.toLocaleLowerCase("ar"), variant]));
  const existingMedia = await db.select().from(productMedia).where(eq(productMedia.productId, product[0].id));
  const existingKeys = new Set(existingMedia.map(media => `${media.variantId ?? ""}:${media.originalFileName ?? ""}`));
  const newRows = validatedLinks
    .map(link => ({
      ...link,
      originalUrl: input.links.find(source => source.colorName.trim() === link.colorName && source.imageFileName === link.imageFileName)?.originalUrl ?? null,
      variant: variantByColor.get(link.colorName.toLocaleLowerCase("ar"))!,
    }))
    .filter(link => !existingKeys.has(`${link.variant.id}:${link.imageFileName}`));
  if (newRows.length > 0) {
    await db.insert(productMedia).values(newRows.map((link, index) => ({
      productId: product[0].id,
      variantId: link.variant.id,
      source: "onedrive" as const,
      mediaType: "image" as const,
      originalUrl: link.originalUrl,
      storageKey: null,
      originalFileName: link.imageFileName,
      colorVerified: true,
      sortOrder: index,
    })));
  }
  return {
    productId: product[0].id,
    productCode: product[0].productCode,
    attached: newRows.map(link => ({ colorName: link.colorName, imageFileName: link.imageFileName })),
    skippedExisting: validatedLinks.filter(link => !newRows.some(row => row.colorName === link.colorName && row.imageFileName === link.imageFileName)),
    copiedOriginalFiles: false,
    generatedOperationalCopies: false,
  };
}

export async function saveOperationalMediaCopy(input: {
  mediaId: number;
  storageKey: string;
  metadata: Record<string, unknown>;
  createdByUserId: number;
  lifecycleAction: "operational_copy_created" | "operational_copy_regenerated";
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const media = await db.select().from(productMedia).where(eq(productMedia.id, input.mediaId)).limit(1);
  if (!media[0]) throw new Error("مرجع وسيط المنتج غير موجود.");
  await db.transaction(async tx => {
    await tx.update(productMedia).set({
      storageKey: input.storageKey,
      operationalMetadata: JSON.stringify(input.metadata),
    }).where(eq(productMedia.id, input.mediaId));
    await tx.insert(productMediaLifecycleEvents).values({
      productId: media[0].productId,
      mediaId: input.mediaId,
      action: input.lifecycleAction,
      result: "succeeded",
      createdByUserId: input.createdByUserId,
    });
  });
}

/**
 * Removes the database reference to a OneDrive image and its derived WebP.
 * The configured storage API provides no object-delete primitive, so clearing
 * the key and deleting this media row is the supported, non-discoverable
 * release mechanism. This function never calls Microsoft Graph.
 */
export async function detachProductMediaReference(input: { productId: number; mediaId: number; createdByUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const media = await db.select().from(productMedia).where(and(eq(productMedia.id, input.mediaId), eq(productMedia.productId, input.productId))).limit(1);
  if (!media[0]) throw new Error("مرجع الصورة غير موجود لهذا المنتج.");
  const plan = planOperationalReferenceDetach(media[0]);
  await db.transaction(async tx => {
    await tx.delete(productMedia).where(eq(productMedia.id, input.mediaId));
    await tx.insert(productMediaLifecycleEvents).values({
      productId: input.productId,
      mediaId: input.mediaId,
      action: "reference_detached",
      result: "succeeded",
      createdByUserId: input.createdByUserId,
    });
  });
  return plan;
}

/**
 * Performs a database-only final deletion. It releases all product-media
 * references first, records only non-sensitive audit facts, then deletes the
 * product and its variants. It never reaches OneDrive or removes source files.
 */
export async function permanentlyDeleteProduct(input: { productId: number; expectedProductCode: string; createdByUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const product = await db.select().from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product[0]) throw new Error("المنتج غير موجود.");
  if (product[0].productCode !== input.expectedProductCode) throw new Error("رمز تأكيد الحذف لا يطابق رمز المنتج.");
  const media = await getProductMedia(input.productId);
  const linkedOperationalMedia = media.filter(entry => entry.source === "onedrive" && entry.mediaType === "image");
  await db.transaction(async tx => {
    if (linkedOperationalMedia.length > 0) {
      await tx.insert(productMediaLifecycleEvents).values(linkedOperationalMedia.map(entry => ({
        productId: input.productId,
        mediaId: entry.id,
        action: "product_purged" as const,
        result: "succeeded" as const,
        createdByUserId: input.createdByUserId,
      })));
    }
    await tx.update(productImportJobs).set({ linkedProductId: null }).where(eq(productImportJobs.linkedProductId, input.productId));
    await tx.delete(productMedia).where(eq(productMedia.productId, input.productId));
    await tx.delete(productVariants).where(eq(productVariants.productId, input.productId));
    await tx.delete(products).where(eq(products.id, input.productId));
  });
  return { productId: input.productId, releasedMediaReferences: linkedOperationalMedia.length, originalFilesModified: false as const };
}

export async function updateVariantInventory(input: { variantId: number; inventoryQuantity: number; actorUserId?: number; source?: "products_ui" | "whatsapp" }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, input.variantId)).limit(1);
  if (!variant) throw new Error("متغير المنتج غير موجود.");
  const availability: "available" | "low_stock" | "out_of_stock" = input.inventoryQuantity <= 0 ? "out_of_stock" : input.inventoryQuantity <= 3 ? "low_stock" : "available";
  await db.transaction(async tx => {
    await tx.update(productVariants).set({ inventoryQuantity: input.inventoryQuantity, availability }).where(eq(productVariants.id, input.variantId));
    if (input.actorUserId) await tx.insert(productOperations).values({
      productId: variant.productId,
      actorUserId: input.actorUserId,
      source: input.source ?? "products_ui",
      action: "inventory_updated",
      changes: JSON.stringify({ variantId: input.variantId, inventoryQuantity: input.inventoryQuantity, availability }),
    });
  });
}

export async function createImportJob(input: {
  source: "onedrive" | "manual";
  sourceReference?: string;
  createdByUserId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const result = await db.insert(productImportJobs).values({
    source: input.source,
    sourceReference: input.sourceReference ?? null,
    createdByUserId: input.createdByUserId,
  });
  return Number(result[0].insertId);
}

export async function listImportJobs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productImportJobs).orderBy(desc(productImportJobs.createdAt));
}
