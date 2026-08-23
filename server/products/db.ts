import { desc, eq } from "drizzle-orm";
import { productImportJobs, productMedia, productVariants, products } from "../../drizzle/schema";
import { normalizeApprovedColorNames, validateApprovedImageColorLinks } from "../integrations/onedrive/productMetadata";
import { getDb } from "../db";

export async function listProducts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(products).orderBy(desc(products.updatedAt));
}

export async function getProductWithVariants(productId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!result[0]) return null;
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
  return { product: result[0], variants };
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

export async function updateVariantInventory(variantId: number, inventoryQuantity: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const availability: "available" | "low_stock" | "out_of_stock" = inventoryQuantity <= 0 ? "out_of_stock" : inventoryQuantity <= 3 ? "low_stock" : "available";
  await db.update(productVariants).set({ inventoryQuantity, availability }).where(eq(productVariants.id, variantId));
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
