import { and, eq, gte, lt, ne } from "drizzle-orm";
import {
  contentPosts,
  customerProfiles,
  customerTasks,
  inboxConversations,
  marketingCampaigns,
  orders,
  storeSettings,
} from "../../drizzle/schema";
import { getDb } from "../db";

const orderStatuses = ["new", "needs_contact", "confirmed", "preparing", "out_for_delivery", "completed", "cancelled"] as const;
const contentStatuses = ["draft", "needs_review", "approved", "changes_requested", "archived"] as const;
const campaignStatuses = ["draft", "needs_approval", "approved", "changes_requested", "archived"] as const;

export type AnalyticsPeriod = { startAt: Date; endAt: Date };

function asNumber(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysInRange(period: AnalyticsPeriod) {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(period.startAt.getUTCFullYear(), period.startAt.getUTCMonth(), period.startAt.getUTCDate()));
  while (cursor < period.endAt) {
    days.push(dayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function countByStatus<T extends string>(rows: Array<{ status: T }>, statuses: readonly T[]) {
  const result = Object.fromEntries(statuses.map(status => [status, 0])) as Record<T, number>;
  for (const row of rows) result[row.status] = (result[row.status] ?? 0) + 1;
  return result;
}

function compare(current: number, previous: number) {
  return {
    current,
    previous,
    change: current - previous,
    changePercent: previous === 0 ? null : Number((((current - previous) / previous) * 100).toFixed(1)),
  };
}

function previousPeriod(period: AnalyticsPeriod): AnalyticsPeriod {
  const duration = period.endAt.getTime() - period.startAt.getTime();
  return { startAt: new Date(period.startAt.getTime() - duration), endAt: new Date(period.startAt.getTime()) };
}

export async function getAnalyticsOverview(input: { storeId: number; period: AnalyticsPeriod; now?: Date }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const now = input.now ?? new Date();
  const previous = previousPeriod(input.period);

  const [currentOrders, previousOrders, allStoreOrders, customersCreated, allCustomers, tasks, conversations, content, campaigns, settings] = await Promise.all([
    db.select({ id: orders.id, status: orders.status, total: orders.total, customerId: orders.customerId, createdAt: orders.createdAt }).from(orders).where(and(eq(orders.storeId, input.storeId), gte(orders.createdAt, input.period.startAt), lt(orders.createdAt, input.period.endAt))),
    db.select({ total: orders.total }).from(orders).where(and(eq(orders.storeId, input.storeId), gte(orders.createdAt, previous.startAt), lt(orders.createdAt, previous.endAt))),
    db.select({ customerId: orders.customerId }).from(orders).where(eq(orders.storeId, input.storeId)),
    db.select({ id: customerProfiles.id }).from(customerProfiles).where(and(eq(customerProfiles.storeId, input.storeId), gte(customerProfiles.createdAt, input.period.startAt), lt(customerProfiles.createdAt, input.period.endAt))),
    db.select({ id: customerProfiles.id }).from(customerProfiles).where(eq(customerProfiles.storeId, input.storeId)),
    db.select({ id: customerTasks.id, status: customerTasks.status, dueAt: customerTasks.dueAt }).from(customerTasks).where(eq(customerTasks.storeId, input.storeId)),
    db.select({ id: inboxConversations.id, status: inboxConversations.status, assignedEmployeeId: inboxConversations.assignedEmployeeId }).from(inboxConversations).where(eq(inboxConversations.storeId, input.storeId)),
    db.select({ id: contentPosts.id, status: contentPosts.status }).from(contentPosts).where(eq(contentPosts.storeId, input.storeId)),
    db.select({ id: marketingCampaigns.id, status: marketingCampaigns.status, budgetAmount: marketingCampaigns.budgetAmount, budgetCurrency: marketingCampaigns.budgetCurrency }).from(marketingCampaigns).where(and(eq(marketingCampaigns.storeId, input.storeId), ne(marketingCampaigns.status, "archived"))),
    db.select({ currencyCode: storeSettings.currencyCode }).from(storeSettings).where(eq(storeSettings.storeId, input.storeId)).limit(1),
  ]);

  const currentTotal = currentOrders.reduce((sum, order) => sum + asNumber(order.total), 0);
  const previousTotal = previousOrders.reduce((sum, order) => sum + asNumber(order.total), 0);
  const customerOrderCounts = new Map<number, number>();
  for (const order of allStoreOrders) {
    if (order.customerId) customerOrderCounts.set(order.customerId, (customerOrderCounts.get(order.customerId) ?? 0) + 1);
  }
  const daily = new Map(daysInRange(input.period).map(date => [date, { date, orderCount: 0, total: 0 }]));
  for (const order of currentOrders) {
    const key = dayKey(order.createdAt);
    const item = daily.get(key);
    if (item) {
      item.orderCount += 1;
      item.total += asNumber(order.total);
    }
  }
  const budgetByCurrency = new Map<string, number>();
  for (const campaign of campaigns) {
    budgetByCurrency.set(campaign.budgetCurrency, (budgetByCurrency.get(campaign.budgetCurrency) ?? 0) + asNumber(campaign.budgetAmount));
  }

  return {
    generatedAt: now,
    period: { ...input.period, previousStartAt: previous.startAt, previousEndAt: previous.endAt },
    currencyCode: settings[0]?.currencyCode ?? "IQD",
    orders: {
      count: currentOrders.length,
      total: Number(currentTotal.toFixed(2)),
      averageOrderValue: currentOrders.length ? Number((currentTotal / currentOrders.length).toFixed(2)) : 0,
      statusCounts: countByStatus(currentOrders, orderStatuses),
      countComparison: compare(currentOrders.length, previousOrders.length),
      totalComparison: compare(currentTotal, previousTotal),
      daily: Array.from(daily.values()).map(item => ({ ...item, total: Number(item.total.toFixed(2)) })),
    },
    customers: {
      newProfiles: customersCreated.length,
      totalProfiles: allCustomers.length,
      repeatProfiles: Array.from(customerOrderCounts.values()).filter(value => value >= 2).length,
      openTasks: tasks.filter(task => task.status === "open").length,
      overdueTasks: tasks.filter(task => task.status === "open" && task.dueAt !== null && task.dueAt < now).length,
    },
    inbox: {
      open: conversations.filter(item => item.status === "open").length,
      waitingCustomer: conversations.filter(item => item.status === "waiting_customer").length,
      snoozed: conversations.filter(item => item.status === "snoozed").length,
      unassigned: conversations.filter(item => item.status !== "closed" && item.assignedEmployeeId === null).length,
    },
    content: { statusCounts: countByStatus(content, contentStatuses) },
    marketing: {
      statusCounts: countByStatus(campaigns, campaignStatuses),
      plannedBudgets: Array.from(budgetByCurrency.entries()).map(([currencyCode, total]) => ({ currencyCode, total: Number(total.toFixed(2)) })),
    },
    unavailableMetrics: [
      "زيارات المتجر ومعدل التحويل",
      "الوصول والمشاهدات والتفاعل في القنوات الاجتماعية",
      "تسليم الرسائل وفتحها والنقر عليها",
      "الإنفاق الإعلاني الفعلي والعائد والإسناد التسويقي",
    ],
  };
}
