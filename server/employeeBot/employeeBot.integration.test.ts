import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  employeeBotCommandReviews,
  employeeBotCommandSources,
  employeeBotCommands,
  employeeBotSettings,
  employeeBotUsageCounters,
  productOperations,
  productVariants,
  products,
  stores,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { generateEmployeeBotCommand, getEmployeeBotCommand, reviewEmployeeBotCommand } from "./db";

describe("EmployeeBot-E1: مسودات الأوامر ومراجعتها", () => {
  const storeIds: number[] = [];
  const createdUserIds: number[] = [];

  afterEach(async () => {
    const db = await getDb();
    if (!db) return;
    for (const storeId of storeIds.splice(0)) {
      await db.delete(employeeBotCommandReviews).where(eq(employeeBotCommandReviews.storeId, storeId));
      await db.delete(employeeBotCommandSources).where(eq(employeeBotCommandSources.storeId, storeId));
      await db.delete(employeeBotCommands).where(eq(employeeBotCommands.storeId, storeId));
      await db.delete(employeeBotUsageCounters).where(eq(employeeBotUsageCounters.storeId, storeId));
      await db.delete(employeeBotSettings).where(eq(employeeBotSettings.storeId, storeId));
      const storeProducts = await db.select({ id: products.id }).from(products).where(eq(products.storeId, storeId));
      if (storeProducts.length) await db.delete(productOperations).where(inArray(productOperations.productId, storeProducts.map(product => product.id)));
      if (storeProducts.length) await db.delete(productVariants).where(inArray(productVariants.productId, storeProducts.map(product => product.id)));
      await db.delete(products).where(eq(products.storeId, storeId));
      await db.delete(stores).where(eq(stores.id, storeId));
    }
    for (const userId of createdUserIds.splice(0)) await db.delete(users).where(eq(users.id, userId));
  });

  it("ينشئ مسودة كمية من نموذج محاكى ولا يعدل المنتج إلا بعد مراجعة موظف مستقل", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار EmployeeBot-E1.");
    const [owner] = await db.select().from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار EmployeeBot-E1.");
    const reviewerResult = await db.insert(users).values({ openId: `employee-reviewer-${randomUUID()}`, name: "مراجع اختبار", role: "admin" });
    const reviewerId = Number(reviewerResult[0].insertId);
    createdUserIds.push(reviewerId);
    const firstStore = await db.insert(stores).values({ name: "متجر مساعد موظفين أول", slug: `employee-bot-one-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const secondStore = await db.insert(stores).values({ name: "متجر مساعد موظفين ثان", slug: `employee-bot-two-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const firstStoreId = Number(firstStore[0].insertId);
    const secondStoreId = Number(secondStore[0].insertId);
    storeIds.push(firstStoreId, secondStoreId);
    const productResult = await db.insert(products).values({ storeId: firstStoreId, productCode: "HIJ-TEST-1", name: "حجاب اختبار", sellingPrice: "25000.00", status: "active", createdByUserId: owner.id });
    const productId = Number(productResult[0].insertId);
    await db.insert(productVariants).values({ productId, colorName: "زيتي", sizeLabel: "", inventoryQuantity: 4, availability: "available" });

    const command = await generateEmployeeBotCommand({
      storeId: firstStoreId,
      actorUserId: owner.id,
      rawCommand: "اجعل كمية اللون الزيتي من HIJ-TEST-1 تساوي 12",
      llm: async () => ({ choices: [{ message: { content: JSON.stringify({ intent: "inventory_set", productCode: "HIJ-TEST-1", colorName: "زيتي", quantity: 12, sellingPrice: null, orderNumber: null, nextStatus: null, needsClarification: false, clarification: null, confidence: 95 }) } }] }) as any,
    });
    expect(command).toMatchObject({ intent: "inventory_set", status: "needs_review", productId, confidence: 95 });
    expect(command.sources).toHaveLength(2);
    const [beforeReview] = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
    expect(beforeReview?.inventoryQuantity).toBe(4);
    await expect(reviewEmployeeBotCommand({ storeId: firstStoreId, commandId: command.id, reviewerUserId: owner.id, decision: "approved" })).rejects.toThrow("لا يمكن لمنشئ المسودة");
    await expect(getEmployeeBotCommand(secondStoreId, command.id)).rejects.toThrow("غير موجودة في المتجر التشغيلي");

    const executed = await reviewEmployeeBotCommand({ storeId: firstStoreId, commandId: command.id, reviewerUserId: reviewerId, decision: "approved" });
    expect(executed.status).toBe("executed");
    const [afterReview] = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
    expect(afterReview?.inventoryQuantity).toBe(12);
    expect(executed.review).toMatchObject({ decision: "approved", reviewerUserId: reviewerId });
  }, 20_000);

  it("يصعّد التفسير منخفض الثقة إلى GPT-5 ثم يسجل الحاجة إلى استيضاح من دون تنفيذ", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار EmployeeBot-E1.");
    const [owner] = await db.select().from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار EmployeeBot-E1.");
    const store = await db.insert(stores).values({ name: "متجر تصعيد مساعد", slug: `employee-bot-escalation-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const storeId = Number(store[0].insertId);
    storeIds.push(storeId);
    const observedModels: string[] = [];
    const command = await generateEmployeeBotCommand({
      storeId,
      actorUserId: owner.id,
      rawCommand: "عدّل الحجاب الذي تكلمنا عنه",
      llm: async params => {
        observedModels.push(params.model ?? "");
        const parsed = observedModels.length === 1
          ? { intent: "clarification", productCode: null, colorName: null, quantity: null, sellingPrice: null, orderNumber: null, nextStatus: null, needsClarification: true, clarification: "المنتج غير محدد.", confidence: 20 }
          : { intent: "clarification", productCode: null, colorName: null, quantity: null, sellingPrice: null, orderNumber: null, nextStatus: null, needsClarification: true, clarification: "حدّد رمز المنتج والتغيير المطلوب.", confidence: 92 };
        return { choices: [{ message: { content: JSON.stringify(parsed) } }] } as any;
      },
    });
    expect(observedModels).toEqual(["gpt-5-mini", "gpt-5"]);
    expect(command).toMatchObject({ intent: "clarification", status: "needs_clarification", model: "gpt-5", escalationReason: "المسار السريع طلب استيضاحاً" });
    expect(JSON.parse(command.proposedChanges)).toMatchObject({ clarification: "حدّد رمز المنتج والتغيير المطلوب." });
  }, 20_000);
});
