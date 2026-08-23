import { desc, eq } from "drizzle-orm";
import { productImportJobs, productVariants, products } from "../../drizzle/schema";
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
