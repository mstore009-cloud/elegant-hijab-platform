import { and, desc, eq } from "drizzle-orm";
import { productFinancialChangeEvents, products } from "../../drizzle/schema";
import { getDb } from "../db";

export type FinancialPatch = {
  costPrice?: string | null;
  targetMarginPercent?: string | null;
};

function requireDb<T>(db: T | null): T {
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

export async function listFinancialProducts(storeId: number) {
  const db = requireDb(await getDb());
  return db
    .select({
      id: products.id,
      productCode: products.productCode,
      name: products.name,
      category: products.category,
      status: products.status,
      sellingPrice: products.sellingPrice,
      costPrice: products.costPrice,
      targetMarginPercent: products.targetMarginPercent,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(eq(products.storeId, storeId))
    .orderBy(desc(products.updatedAt), desc(products.id));
}

export async function getProductFinancialDetail(input: { storeId: number; productId: number }) {
  const db = requireDb(await getDb());
  const [product] = await db
    .select({
      id: products.id,
      productCode: products.productCode,
      name: products.name,
      category: products.category,
      status: products.status,
      sellingPrice: products.sellingPrice,
      costPrice: products.costPrice,
      targetMarginPercent: products.targetMarginPercent,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.storeId, input.storeId)))
    .limit(1);

  if (!product) throw new Error("المنتج غير موجود في متجرك التشغيلي.");

  const changes = await db
    .select({
      id: productFinancialChangeEvents.id,
      actorUserId: productFinancialChangeEvents.actorUserId,
      priorCostPrice: productFinancialChangeEvents.priorCostPrice,
      nextCostPrice: productFinancialChangeEvents.nextCostPrice,
      priorTargetMarginPercent: productFinancialChangeEvents.priorTargetMarginPercent,
      nextTargetMarginPercent: productFinancialChangeEvents.nextTargetMarginPercent,
      reason: productFinancialChangeEvents.reason,
      createdAt: productFinancialChangeEvents.createdAt,
    })
    .from(productFinancialChangeEvents)
    .where(and(eq(productFinancialChangeEvents.storeId, input.storeId), eq(productFinancialChangeEvents.productId, input.productId)))
    .orderBy(desc(productFinancialChangeEvents.createdAt), desc(productFinancialChangeEvents.id))
    .limit(60);

  return { product, changes };
}

export async function updateProductFinancials(input: FinancialPatch & { storeId: number; productId: number; actorUserId: number; reason: string }) {
  if (input.costPrice === undefined && input.targetMarginPercent === undefined) {
    throw new Error("أدخل التكلفة أو الهامش المستهدف لتحديثهما.");
  }

  const db = requireDb(await getDb());
  return db.transaction(async tx => {
    const [existing] = await tx
      .select({
        id: products.id,
        sellingPrice: products.sellingPrice,
        costPrice: products.costPrice,
        targetMarginPercent: products.targetMarginPercent,
      })
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.storeId, input.storeId)))
      .limit(1);

    if (!existing) throw new Error("المنتج غير موجود في متجرك التشغيلي.");

    const updateValues: FinancialPatch = {};
    if (input.costPrice !== undefined) updateValues.costPrice = input.costPrice;
    if (input.targetMarginPercent !== undefined) updateValues.targetMarginPercent = input.targetMarginPercent;

    await tx.update(products).set(updateValues).where(and(eq(products.id, input.productId), eq(products.storeId, input.storeId)));
    await tx.insert(productFinancialChangeEvents).values({
      storeId: input.storeId,
      productId: input.productId,
      actorUserId: input.actorUserId,
      priorCostPrice: existing.costPrice,
      nextCostPrice: input.costPrice === undefined ? existing.costPrice : input.costPrice,
      priorTargetMarginPercent: existing.targetMarginPercent,
      nextTargetMarginPercent: input.targetMarginPercent === undefined ? existing.targetMarginPercent : input.targetMarginPercent,
      reason: input.reason,
    });

    return {
      productId: existing.id,
      sellingPrice: existing.sellingPrice,
      costPrice: input.costPrice === undefined ? existing.costPrice : input.costPrice,
      targetMarginPercent: input.targetMarginPercent === undefined ? existing.targetMarginPercent : input.targetMarginPercent,
    };
  });
}

export async function recordInitialProductFinancialValues(input: FinancialPatch & { storeId: number; productId: number; actorUserId: number }) {
  if (input.costPrice === undefined && input.targetMarginPercent === undefined) return;
  const db = requireDb(await getDb());
  await db.insert(productFinancialChangeEvents).values({
    storeId: input.storeId,
    productId: input.productId,
    actorUserId: input.actorUserId,
    priorCostPrice: null,
    nextCostPrice: input.costPrice ?? null,
    priorTargetMarginPercent: null,
    nextTargetMarginPercent: input.targetMarginPercent ?? null,
    reason: "تسجيل القيمة عند إنشاء المنتج",
  });
}
