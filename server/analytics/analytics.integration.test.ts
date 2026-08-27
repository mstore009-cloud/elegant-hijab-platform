import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentPosts,
  customerProfiles,
  customerTasks,
  inboxConversations,
  marketingCampaigns,
  orders,
  storeSettings,
  stores,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { getAnalyticsOverview } from "./db";

describe("Analytics-A: مؤشرات تشغيلية ضمن المتجر", () => {
  const cleanup: Array<{ storeId: number; customerIds: number[] }> = [];

  afterEach(async () => {
    const db = await getDb();
    if (!db) return;
    for (const entry of cleanup.splice(0)) {
      await db.delete(marketingCampaigns).where(eq(marketingCampaigns.storeId, entry.storeId));
      await db.delete(contentPosts).where(eq(contentPosts.storeId, entry.storeId));
      await db.delete(inboxConversations).where(eq(inboxConversations.storeId, entry.storeId));
      await db.delete(orders).where(eq(orders.storeId, entry.storeId));
      await db.delete(customerTasks).where(eq(customerTasks.storeId, entry.storeId));
      for (const customerId of entry.customerIds) await db.delete(customerProfiles).where(eq(customerProfiles.id, customerId));
      await db.delete(storeSettings).where(eq(storeSettings.storeId, entry.storeId));
      await db.delete(stores).where(eq(stores.id, entry.storeId));
    }
  });

  it("يحسب الطلبات والعملاء وInbox والمحتوى والتخطيط ضمن المتجر والفترة فقط", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار Analytics-A.");
    const [owner] = await db.select().from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار Analytics-A.");

    const firstStore = await db.insert(stores).values({ name: "متجر اختبار تحليلات 1", slug: `analytics-one-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const secondStore = await db.insert(stores).values({ name: "متجر اختبار تحليلات 2", slug: `analytics-two-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const firstStoreId = Number(firstStore[0].insertId);
    const secondStoreId = Number(secondStore[0].insertId);
    cleanup.push({ storeId: firstStoreId, customerIds: [] }, { storeId: secondStoreId, customerIds: [] });
    await db.insert(storeSettings).values({ storeId: firstStoreId, currencyCode: "IQD" });

    const firstCustomer = await db.insert(customerProfiles).values({ storeId: firstStoreId, displayName: "عميلة تحليل أولى", phoneNormalized: `96477${randomUUID().replace(/-/g, "").slice(0, 8)}`, phoneDisplay: "07700000001", createdAt: new Date("2026-01-02T08:00:00.000Z") });
    const secondCustomer = await db.insert(customerProfiles).values({ storeId: firstStoreId, displayName: "عميلة تحليل ثانية", phoneNormalized: `96478${randomUUID().replace(/-/g, "").slice(0, 8)}`, phoneDisplay: "07700000002", createdAt: new Date("2025-12-20T08:00:00.000Z") });
    const otherCustomer = await db.insert(customerProfiles).values({ storeId: secondStoreId, displayName: "عميلة متجر ثان", phoneNormalized: `96479${randomUUID().replace(/-/g, "").slice(0, 8)}`, phoneDisplay: "07700000003" });
    const firstCustomerId = Number(firstCustomer[0].insertId);
    const secondCustomerId = Number(secondCustomer[0].insertId);
    const otherCustomerId = Number(otherCustomer[0].insertId);
    cleanup[0].customerIds.push(firstCustomerId, secondCustomerId);
    cleanup[1].customerIds.push(otherCustomerId);

    const makeOrder = (input: { storeId: number; customerId: number; total: string; status: "new" | "completed"; createdAt: Date; suffix: string }) => db.insert(orders).values({
      storeId: input.storeId,
      customerId: input.customerId,
      orderNumber: `AN-${input.suffix}-${randomUUID().slice(0, 8)}`,
      status: input.status,
      source: "manual",
      customerChannel: "manual",
      customerName: "لقطة عميلة خاصة",
      customerPhone: "07700000000",
      governorate: "بغداد",
      address: "عنوان خاص لا يجب عرضه",
      subtotal: input.total,
      total: input.total,
      createdAt: input.createdAt,
    });
    await makeOrder({ storeId: firstStoreId, customerId: firstCustomerId, total: "10000.00", status: "new", createdAt: new Date("2026-01-02T09:00:00.000Z"), suffix: "current-a" });
    await makeOrder({ storeId: firstStoreId, customerId: firstCustomerId, total: "20000.00", status: "completed", createdAt: new Date("2026-01-03T09:00:00.000Z"), suffix: "current-b" });
    await makeOrder({ storeId: firstStoreId, customerId: secondCustomerId, total: "5000.00", status: "completed", createdAt: new Date("2025-12-29T09:00:00.000Z"), suffix: "previous" });
    await makeOrder({ storeId: secondStoreId, customerId: otherCustomerId, total: "99000.00", status: "completed", createdAt: new Date("2026-01-03T09:00:00.000Z"), suffix: "other" });

    await db.insert(customerTasks).values({ storeId: firstStoreId, customerId: firstCustomerId, title: "متابعة تحليلية", status: "open", dueAt: new Date("2026-01-04T09:00:00.000Z"), createdByUserId: owner.id });
    await db.insert(inboxConversations).values([
      { storeId: firstStoreId, customerId: firstCustomerId, channel: "manual", status: "open", subject: "استفسار تحليل" },
      { storeId: firstStoreId, customerId: secondCustomerId, channel: "manual", status: "waiting_customer", subject: "متابعة تحليل" },
      { storeId: secondStoreId, customerId: otherCustomerId, channel: "manual", status: "snoozed", subject: "متجر ثان" },
    ]);
    await db.insert(contentPosts).values({ storeId: firstStoreId, status: "needs_review", title: "محتوى تحليلي", contentType: "feed_post", channelPlan: "general", createdByUserId: owner.id });
    await db.insert(marketingCampaigns).values({ storeId: firstStoreId, name: "تخطيط تحليلي", objective: "promotion", status: "approved", audienceType: "all_customers", budgetAmount: "12500.00", budgetCurrency: "IQD", createdByUserId: owner.id });

    const overview = await getAnalyticsOverview({
      storeId: firstStoreId,
      period: { startAt: new Date("2026-01-01T00:00:00.000Z"), endAt: new Date("2026-01-05T00:00:00.000Z") },
      now: new Date("2026-01-10T00:00:00.000Z"),
    });

    expect(overview.orders).toMatchObject({ count: 2, total: 30000, averageOrderValue: 15000, statusCounts: { new: 1, completed: 1 }, countComparison: { previous: 1 }, totalComparison: { previous: 5000 } });
    expect(overview.orders.daily.find(item => item.date === "2026-01-02")).toMatchObject({ orderCount: 1, total: 10000 });
    expect(overview.customers).toMatchObject({ newProfiles: 1, totalProfiles: 2, repeatProfiles: 1, openTasks: 1, overdueTasks: 1 });
    expect(overview.inbox).toMatchObject({ open: 1, waitingCustomer: 1, snoozed: 0, unassigned: 2 });
    expect(overview.content.statusCounts).toMatchObject({ needs_review: 1 });
    expect(overview.marketing).toMatchObject({ statusCounts: { approved: 1 }, plannedBudgets: [{ currencyCode: "IQD", total: 12500 }] });
    expect(JSON.stringify(overview)).not.toContain("07700000000");
    expect(JSON.stringify(overview)).not.toContain("عنوان خاص لا يجب عرضه");

    const otherStoreOverview = await getAnalyticsOverview({ storeId: secondStoreId, period: { startAt: new Date("2026-01-01T00:00:00.000Z"), endAt: new Date("2026-01-05T00:00:00.000Z") }, now: new Date("2026-01-10T00:00:00.000Z") });
    expect(otherStoreOverview.orders).toMatchObject({ count: 1, total: 99000 });
    expect(otherStoreOverview.customers.totalProfiles).toBe(1);
    expect(otherStoreOverview.inbox).toMatchObject({ snoozed: 1, open: 0 });
  }, 20_000);
});
