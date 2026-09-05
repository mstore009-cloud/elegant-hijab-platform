import { and, asc, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import {
  customerProfiles,
  customerActivities,
  employeeProfiles,
  inboxConversationEvents,
  inboxConversations,
  inboxMessageMedia,
  inboxMessageReactions,
  inboxMessages,
  orders,
  customerBotImageAnalyses,
  customerBotImageMatches,
  products,
  channelAccounts,
  channelWebhookEvents,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { appendCustomerActivity } from "../crm/db";
import { deriveChannelHealth } from "../channels/health";
import { listMetaConnectionOverview } from "../integrations/meta/db";
import { notifyEmployee } from "../notifications/db";
import { storageGet } from "../storage";

export const inboxChannels = ["manual", "whatsapp", "instagram", "messenger"] as const;
export const inboxStatuses = ["open", "waiting_customer", "snoozed", "closed"] as const;
export const inboxMessageDirections = ["inbound", "outbound", "internal_note"] as const;
export type InboxChannel = (typeof inboxChannels)[number];
export type InboxStatus = (typeof inboxStatuses)[number];
export type InboxMessageDirection = (typeof inboxMessageDirections)[number];

type InboxMessageMetadata = {
  messageType?: string | null;
  replyToExternalMessageId?: string | null;
  replyToBodyPreview?: string | null;
  storyId?: string | null;
  mentions?: Array<{ id: string; name?: string | null }>;
  unsupportedReason?: string | null;
};

function parseMessageMetadata(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as InboxMessageMetadata;
    return {
      messageType: typeof parsed.messageType === "string" ? parsed.messageType : null,
      replyToExternalMessageId: typeof parsed.replyToExternalMessageId === "string" ? parsed.replyToExternalMessageId : null,
      replyToBodyPreview: typeof parsed.replyToBodyPreview === "string" ? parsed.replyToBodyPreview : null,
      storyId: typeof parsed.storyId === "string" ? parsed.storyId : null,
      mentions: Array.isArray(parsed.mentions) ? parsed.mentions.filter(item => item && typeof item.id === "string").slice(0, 20) : [],
      unsupportedReason: typeof parsed.unsupportedReason === "string" ? parsed.unsupportedReason : null,
    } satisfies InboxMessageMetadata;
  } catch {
    return null;
  }
}

export async function listInboxMetaActivity(storeId: number, limit = 30) {
  const db = await requireDb();
  const rows = await db.select({ id: channelWebhookEvents.id, eventType: channelWebhookEvents.eventType, processingStatus: channelWebhookEvents.processingStatus, normalizedPayloadJson: channelWebhookEvents.normalizedPayloadJson, receivedAt: channelWebhookEvents.receivedAt, processedAt: channelWebhookEvents.processedAt, errorSummary: channelWebhookEvents.errorSummary })
    .from(channelWebhookEvents)
    .where(and(eq(channelWebhookEvents.storeId, storeId), inArray(channelWebhookEvents.eventType, ["comment", "mention"])))
    .orderBy(desc(channelWebhookEvents.receivedAt), desc(channelWebhookEvents.id))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map(row => {
    let parsed: any = null;
    try { parsed = row.normalizedPayloadJson ? JSON.parse(row.normalizedPayloadJson) : null; } catch { parsed = null; }
    const data = parsed?.data && typeof parsed.data === "object" ? Object.fromEntries(Object.entries(parsed.data).filter(([key]) => ["commentId", "mediaId", "postId", "message", "summary", "leadId"].includes(key)).slice(0, 10)) : {};
    return { id: row.id, type: row.eventType, channel: parsed?.channel === "instagram" || parsed?.channel === "messenger" ? parsed.channel : "meta", summary: typeof parsed?.summary === "string" ? parsed.summary.slice(0, 500) : row.errorSummary || "نشاط Meta يحتاج مراجعة.", data, processingStatus: row.processingStatus, receivedAt: row.receivedAt, processedAt: row.processedAt };
  });
}

const statusLabels: Record<InboxStatus, string> = {
  open: "مفتوحة",
  waiting_customer: "بانتظار العميل",
  snoozed: "مؤجلة",
  closed: "مغلقة",
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

async function getScopedConversation(db: any, storeId: number, conversationId: number) {
  const [conversation] = await db.select().from(inboxConversations).where(and(eq(inboxConversations.id, conversationId), eq(inboxConversations.storeId, storeId))).limit(1);
  if (!conversation) throw new Error("المحادثة غير موجودة في المتجر التشغيلي الحالي.");
  return conversation;
}

async function getScopedCustomer(db: any, storeId: number, customerId: number) {
  const [customer] = await db.select().from(customerProfiles).where(and(eq(customerProfiles.id, customerId), eq(customerProfiles.storeId, storeId))).limit(1);
  if (!customer) throw new Error("ملف العميل غير موجود في المتجر التشغيلي الحالي.");
  return customer;
}

async function getScopedOrder(db: any, storeId: number, orderId: number) {
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.storeId, storeId))).limit(1);
  if (!order) throw new Error("الطلب غير موجود في المتجر التشغيلي الحالي.");
  return order;
}

async function requireActiveAssignee(db: any, storeId: number, employeeId: number) {
  const [employee] = await db.select().from(employeeProfiles).where(and(eq(employeeProfiles.id, employeeId), eq(employeeProfiles.storeId, storeId), eq(employeeProfiles.isActive, true))).limit(1);
  if (!employee) throw new Error("الموظف المكلّف غير تابع للمتجر الحالي أو غير نشط.");
  return employee;
}

async function appendConversationEvent(db: any, input: {
  storeId: number; conversationId: number; type: "created" | "assigned" | "status_changed" | "priority_changed" | "snoozed" | "customer_linked" | "order_linked" | "message_recorded" | "internal_note_added"; actorUserId?: number | null; fromValue?: string | null; toValue?: string | null;
}) {
  await db.insert(inboxConversationEvents).values({ ...input, actorUserId: input.actorUserId ?? null, fromValue: input.fromValue ?? null, toValue: input.toValue ?? null });
}

async function appendInboxCustomerActivity(db: any, input: { storeId: number; customerId: number | null; title: string; body?: string | null; actorUserId: number }) {
  if (!input.customerId) return;
  await appendCustomerActivity(db, { storeId: input.storeId, customerId: input.customerId, type: "inbox_message", title: input.title, body: input.body, actorUserId: input.actorUserId });
}

export async function listInboxConversations(storeId: number, userId: number, input: { search?: string; status?: InboxStatus; channel?: InboxChannel; assignment?: "all" | "mine" | "unassigned"; hasAttachments?: boolean; readState?: "all" | "unread" | "read"; limit?: number }) {
  const db = await requireDb();
  const filters = [eq(inboxConversations.storeId, storeId)];
  if (input.status) filters.push(eq(inboxConversations.status, input.status));
  if (input.channel) filters.push(eq(inboxConversations.channel, input.channel));
  if (input.assignment === "unassigned") filters.push(isNull(inboxConversations.assignedEmployeeId));
  if (input.assignment === "mine") {
    const [employee] = await db.select({ id: employeeProfiles.id }).from(employeeProfiles).where(and(eq(employeeProfiles.userId, userId), eq(employeeProfiles.storeId, storeId), eq(employeeProfiles.isActive, true))).limit(1);
    if (!employee) return [];
    filters.push(eq(inboxConversations.assignedEmployeeId, employee.id));
  }
  const search = input.search?.trim();
  if (search) filters.push(or(like(inboxConversations.subject, `%${search}%`), like(inboxConversations.contactNameSnapshot, `%${search}%`), like(inboxConversations.contactPhoneSnapshot, `%${search}%`))!);
  const conversations = await db.select().from(inboxConversations).where(and(...filters)).orderBy(desc(inboxConversations.priority), desc(inboxConversations.lastMessageAt), desc(inboxConversations.updatedAt)).limit(Math.min(Math.max(input.limit ?? 100, 1), 200));
  if (!conversations.length) return [];
  const ids = conversations.map(row => row.id);
  const customerIds = conversations.flatMap(row => row.customerId ? [row.customerId] : []);
  const employeeIds = conversations.flatMap(row => row.assignedEmployeeId ? [row.assignedEmployeeId] : []);
  const orderIds = conversations.flatMap(row => row.orderId ? [row.orderId] : []);
  const [customers, employees, linkedOrders, messages] = await Promise.all([
    customerIds.length ? db.select({ id: customerProfiles.id, displayName: customerProfiles.displayName, phoneDisplay: customerProfiles.phoneDisplay, profileImageUrl: customerProfiles.profileImageUrl, socialUsername: customerProfiles.socialUsername, externalProfileId: customerProfiles.externalProfileId, governorate: customerProfiles.governorate, relationshipStage: customerProfiles.relationshipStage }).from(customerProfiles).where(and(eq(customerProfiles.storeId, storeId), inArray(customerProfiles.id, customerIds))) : [],
    employeeIds.length ? db.select({ id: employeeProfiles.id, displayName: employeeProfiles.displayName }).from(employeeProfiles).where(and(eq(employeeProfiles.storeId, storeId), inArray(employeeProfiles.id, employeeIds))) : [],
    orderIds.length ? db.select({ id: orders.id, orderNumber: orders.orderNumber, customerId: orders.customerId }).from(orders).where(and(eq(orders.storeId, storeId), inArray(orders.id, orderIds))) : [],
    db.select().from(inboxMessages).where(inArray(inboxMessages.conversationId, ids)).orderBy(desc(inboxMessages.occurredAt), desc(inboxMessages.id)),
  ]);
  const latestMessage = new Map<number, any>();
  const unreadCounts = new Map<number, number>();
  for (const message of messages) {
    if (!latestMessage.has(message.conversationId)) latestMessage.set(message.conversationId, message);
    if (message.direction === "inbound" && !message.readAt) unreadCounts.set(message.conversationId, (unreadCounts.get(message.conversationId) ?? 0) + 1);
  }
  const messageIds = messages.map(message => message.id);
  const mediaRows = messageIds.length ? await db.select({ messageId: inboxMessageMedia.messageId }).from(inboxMessageMedia).where(and(eq(inboxMessageMedia.storeId, storeId), inArray(inboxMessageMedia.messageId, messageIds))) : [];
  const mediaConversationIds = new Set(messages.filter(message => mediaRows.some(media => media.messageId === message.id)).map(message => message.conversationId));
  const filteredConversations = conversations.filter(conversation => {
    if (input.hasAttachments && !mediaConversationIds.has(conversation.id)) return false;
    const unread = unreadCounts.get(conversation.id) ?? 0;
    if (input.readState === "unread" && unread === 0) return false;
    if (input.readState === "read" && unread > 0) return false;
    return true;
  });
  return filteredConversations.map(conversation => ({
    ...conversation,
    customer: customers.find(customer => customer.id === conversation.customerId) ?? null,
    assignee: employees.find(employee => employee.id === conversation.assignedEmployeeId) ?? null,
    order: linkedOrders.find(order => order.id === conversation.orderId) ?? null,
    latestMessage: latestMessage.get(conversation.id) ?? null,
    unreadCount: unreadCounts.get(conversation.id) ?? 0,
    hasAttachments: mediaConversationIds.has(conversation.id),
  }));
}

export async function getInboxConversationDetail(storeId: number, conversationId: number) {
  const db = await requireDb();
  const conversation = await getScopedConversation(db, storeId, conversationId);
  const [messages, events, customer, linkedOrder, assignee] = await Promise.all([
    db.select().from(inboxMessages).where(eq(inboxMessages.conversationId, conversation.id)).orderBy(asc(inboxMessages.occurredAt), asc(inboxMessages.id)),
    db.select().from(inboxConversationEvents).where(and(eq(inboxConversationEvents.storeId, storeId), eq(inboxConversationEvents.conversationId, conversation.id))).orderBy(desc(inboxConversationEvents.createdAt), desc(inboxConversationEvents.id)),
    conversation.customerId ? getScopedCustomer(db, storeId, conversation.customerId) : null,
    conversation.orderId ? getScopedOrder(db, storeId, conversation.orderId) : null,
    conversation.assignedEmployeeId ? requireActiveAssignee(db, storeId, conversation.assignedEmployeeId) : null,
  ]);
  const customerOrders = customer ? await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, total: orders.total, createdAt: orders.createdAt }).from(orders).where(and(eq(orders.storeId, storeId), eq(orders.customerId, customer.id))).orderBy(desc(orders.createdAt)).limit(6) : [];
  const messageIds = messages.map(message => message.id);
  const media = await listInboxMessageMediaForConversation(storeId, conversation.id, messageIds);
  const reactions = messageIds.length ? await db.select().from(inboxMessageReactions).where(and(eq(inboxMessageReactions.storeId, storeId), inArray(inboxMessageReactions.messageId, messageIds))).orderBy(asc(inboxMessageReactions.occurredAt), asc(inboxMessageReactions.id)) : [];
  const [channelAccount] = conversation.channel === "manual" ? [] : conversation.channelAccountId
    ? await db.select().from(channelAccounts).where(and(eq(channelAccounts.id, conversation.channelAccountId), eq(channelAccounts.storeId, storeId))).limit(1)
    : await db.select().from(channelAccounts).where(and(eq(channelAccounts.storeId, storeId), eq(channelAccounts.channel, conversation.channel))).limit(1);
  const metaOverview = channelAccount && conversation.channel !== "manual" ? await listMetaConnectionOverview(storeId) : null;
  const channelHealth = channelAccount && metaOverview && conversation.channel !== "manual"
    ? deriveChannelHealth({ channel: conversation.channel as "whatsapp" | "instagram" | "messenger", account: channelAccount, connections: metaOverview.connections, assets: metaOverview.assets, capabilities: metaOverview.capabilities })
    : null;
  const normalizedMessages = messages.map(message => ({ ...message, metadata: parseMessageMetadata(message.metadataJson) }));
  return { conversation, messages: normalizedMessages, events, customer, linkedOrder, assignee, customerOrders, media, reactions, channelAccount: channelAccount ?? null, channelHealth };
}

async function listInboxMessageMediaForConversation(storeId: number, conversationId: number, messageIds: number[]) {
  if (!messageIds.length) return [];
  const db = await requireDb();
  await getScopedConversation(db, storeId, conversationId);
  const mediaRows = await db.select().from(inboxMessageMedia).where(and(eq(inboxMessageMedia.storeId, storeId), inArray(inboxMessageMedia.messageId, messageIds))).orderBy(asc(inboxMessageMedia.id));
  if (!mediaRows.length) return [];
  const mediaIds = mediaRows.map(media => media.id);
  const analyses = await db.select().from(customerBotImageAnalyses).where(and(eq(customerBotImageAnalyses.storeId, storeId), inArray(customerBotImageAnalyses.mediaId, mediaIds)));
  const analysisIds = analyses.map(analysis => analysis.id);
  const matches = analysisIds.length
    ? await db.select({ analysisId: customerBotImageMatches.analysisId, confidence: customerBotImageMatches.confidence, reason: customerBotImageMatches.matchReason, productCode: products.productCode, productName: products.name, sellingPrice: products.sellingPrice })
      .from(customerBotImageMatches)
      .innerJoin(products, eq(customerBotImageMatches.productId, products.id))
      .where(and(eq(customerBotImageMatches.storeId, storeId), inArray(customerBotImageMatches.analysisId, analysisIds), eq(products.storeId, storeId)))
      .orderBy(customerBotImageMatches.rank)
    : [];
  return Promise.all(mediaRows.map(async media => {
    const analysis = analyses.find(item => item.mediaId === media.id) ?? null;
    return {
      id: media.id,
      messageId: media.messageId,
      mediaType: media.mediaType,
      mimeType: media.mimeType,
      originalFileName: media.originalFileName,
      sizeBytes: media.sizeBytes,
      downloadStatus: media.downloadStatus,
      errorSummary: media.errorSummary,
      url: media.storageKey ? (await storageGet(media.storageKey)).url : null,
      analysis: analysis ? {
        id: analysis.id,
        status: analysis.status,
        model: analysis.model,
        confidence: analysis.confidence,
        garmentType: analysis.garmentType,
        dominantColor: analysis.dominantColor,
        secondaryColors: analysis.secondaryColors,
        pattern: analysis.pattern,
        detectedText: analysis.detectedText,
        visualSummary: analysis.visualSummary,
        suitableForMatching: analysis.suitableForMatching,
        errorSummary: analysis.errorSummary,
        matches: matches.filter(match => match.analysisId === analysis.id),
      } : null,
    };
  }));
}

export async function listInboxAssignableEmployees(storeId: number) {
  const db = await requireDb();
  return db.select({ id: employeeProfiles.id, displayName: employeeProfiles.displayName, jobTitle: employeeProfiles.jobTitle }).from(employeeProfiles).where(and(eq(employeeProfiles.storeId, storeId), eq(employeeProfiles.isActive, true))).orderBy(employeeProfiles.displayName);
}

export async function listInboxCustomers(storeId: number, search?: string) {
  const db = await requireDb();
  const filters = [eq(customerProfiles.storeId, storeId)];
  if (search?.trim()) filters.push(or(like(customerProfiles.displayName, `%${search.trim()}%`), like(customerProfiles.phoneDisplay, `%${search.trim()}%`))!);
  return db.select({ id: customerProfiles.id, displayName: customerProfiles.displayName, phoneDisplay: customerProfiles.phoneDisplay }).from(customerProfiles).where(and(...filters)).orderBy(desc(customerProfiles.lastOrderAt), customerProfiles.displayName).limit(50);
}

export async function createManualConversation(input: { storeId: number; actorUserId: number; customerId?: number | null; orderId?: number | null; subject?: string | null; contactName?: string | null; contactPhone?: string | null }) {
  const db = await requireDb();
  let customerId = input.customerId ?? null;
  let customer: any = customerId ? await getScopedCustomer(db, input.storeId, customerId) : null;
  const order = input.orderId ? await getScopedOrder(db, input.storeId, input.orderId) : null;
  const orderCustomerId = order?.customerId;
  if (orderCustomerId) {
    if (customerId && customerId !== orderCustomerId) throw new Error("لا يمكن ربط محادثة عميل بطلب يخص ملف عميل آخر.");
    customerId = orderCustomerId;
    customer = await getScopedCustomer(db, input.storeId, orderCustomerId);
  }
  const contactName = (input.contactName?.trim() || customer?.displayName || "").slice(0, 160);
  const contactPhone = (input.contactPhone?.trim() || customer?.phoneDisplay || "").slice(0, 40);
  if (!contactName) throw new Error("اسم جهة الاتصال مطلوب عند عدم ربط المحادثة بملف عميل.");
  const result = await db.insert(inboxConversations).values({ storeId: input.storeId, customerId, orderId: order?.id ?? null, channel: "manual", subject: input.subject?.trim() || null, contactNameSnapshot: contactName, contactPhoneSnapshot: contactPhone || null, createdByUserId: input.actorUserId });
  const conversationId = Number(result[0].insertId);
  await appendConversationEvent(db, { storeId: input.storeId, conversationId, type: "created", actorUserId: input.actorUserId, toValue: "manual" });
  if (customerId) await appendInboxCustomerActivity(db, { storeId: input.storeId, customerId, title: "فُتحت محادثة يدوية في Inbox", body: input.subject, actorUserId: input.actorUserId });
  return { conversationId };
}

export async function recordInboxMessage(input: { storeId: number; conversationId: number; direction: InboxMessageDirection; body: string; actorUserId: number }) {
  const db = await requireDb();
  const conversation = await getScopedConversation(db, input.storeId, input.conversationId);
  const body = input.body.trim();
  if (!body) throw new Error("نص الرسالة مطلوب.");
  const result = await db.insert(inboxMessages).values({ conversationId: conversation.id, direction: input.direction, body, actorUserId: input.actorUserId });
  const messageId = Number(result[0].insertId);
  const isInternal = input.direction === "internal_note";
  if (!isInternal) await db.update(inboxConversations).set({ lastMessageAt: new Date() }).where(eq(inboxConversations.id, conversation.id));
  await appendConversationEvent(db, { storeId: input.storeId, conversationId: conversation.id, type: isInternal ? "internal_note_added" : "message_recorded", actorUserId: input.actorUserId, toValue: input.direction });
  const title = isInternal ? "ملاحظة داخلية من Inbox" : input.direction === "inbound" ? "رسالة واردة مسجلة في Inbox" : "رسالة صادرة مسجلة في Inbox";
  await appendInboxCustomerActivity(db, { storeId: input.storeId, customerId: conversation.customerId, title, body, actorUserId: input.actorUserId });
  return { messageId, delivery: "recorded_only" as const };
}

export async function assignInboxConversation(input: { storeId: number; conversationId: number; assigneeEmployeeId?: number | null; actorUserId: number }) {
  const db = await requireDb();
  const conversation = await getScopedConversation(db, input.storeId, input.conversationId);
  const employee = input.assigneeEmployeeId ? await requireActiveAssignee(db, input.storeId, input.assigneeEmployeeId) : null;
  await db.update(inboxConversations).set({ assignedEmployeeId: employee?.id ?? null }).where(eq(inboxConversations.id, conversation.id));
  await appendConversationEvent(db, { storeId: input.storeId, conversationId: conversation.id, type: "assigned", actorUserId: input.actorUserId, fromValue: conversation.assignedEmployeeId ? String(conversation.assignedEmployeeId) : null, toValue: employee ? String(employee.id) : null });
  if (employee && conversation.assignedEmployeeId !== employee.id) {
    try {
      await notifyEmployee({ storeId: input.storeId, employeeId: employee.id, type: "inbox_assigned", priority: "action", title: `أُسندت إليك محادثة: ${conversation.contactNameSnapshot}`, body: "افتحي المحادثة للاطلاع والرد أو المتابعة.", entityType: "inbox_conversation", entityId: conversation.id, route: `/inbox?conversation=${conversation.id}` });
    } catch (error) {
      console.warn("[Notifications] تعذر إنشاء تنبيه تعيين محادثة:", error);
    }
  }
  return employee;
}

export async function changeInboxConversationStatus(input: { storeId: number; conversationId: number; status: InboxStatus; actorUserId: number }) {
  const db = await requireDb();
  const conversation = await getScopedConversation(db, input.storeId, input.conversationId);
  await db.update(inboxConversations).set({ status: input.status, snoozedUntil: input.status === "snoozed" ? conversation.snoozedUntil : null, closedAt: input.status === "closed" ? new Date() : null }).where(eq(inboxConversations.id, conversation.id));
  await appendConversationEvent(db, { storeId: input.storeId, conversationId: conversation.id, type: "status_changed", actorUserId: input.actorUserId, fromValue: conversation.status, toValue: input.status });
  await appendInboxCustomerActivity(db, { storeId: input.storeId, customerId: conversation.customerId, title: `تغيّرت حالة المحادثة إلى: ${statusLabels[input.status]}`, actorUserId: input.actorUserId });
}

export async function setInboxConversationPriority(input: { storeId: number; conversationId: number; priority: boolean; actorUserId: number }) {
  const db = await requireDb();
  const conversation = await getScopedConversation(db, input.storeId, input.conversationId);
  await db.update(inboxConversations).set({ priority: input.priority }).where(eq(inboxConversations.id, conversation.id));
  await appendConversationEvent(db, { storeId: input.storeId, conversationId: conversation.id, type: "priority_changed", actorUserId: input.actorUserId, fromValue: conversation.priority ? "priority" : "normal", toValue: input.priority ? "priority" : "normal" });
}

export async function snoozeInboxConversation(input: { storeId: number; conversationId: number; until: Date; actorUserId: number }) {
  const db = await requireDb();
  const conversation = await getScopedConversation(db, input.storeId, input.conversationId);
  if (input.until.getTime() <= Date.now()) throw new Error("وقت التأجيل يجب أن يكون في المستقبل.");
  await db.update(inboxConversations).set({ status: "snoozed", snoozedUntil: input.until, closedAt: null }).where(eq(inboxConversations.id, conversation.id));
  await appendConversationEvent(db, { storeId: input.storeId, conversationId: conversation.id, type: "snoozed", actorUserId: input.actorUserId, fromValue: conversation.status, toValue: input.until.toISOString() });
}

export async function linkInboxConversationCustomer(input: { storeId: number; conversationId: number; customerId: number; actorUserId: number }) {
  const db = await requireDb();
  const conversation = await getScopedConversation(db, input.storeId, input.conversationId);
  const customer = await getScopedCustomer(db, input.storeId, input.customerId);
  if (conversation.orderId) {
    const order = await getScopedOrder(db, input.storeId, conversation.orderId);
    if (order.customerId && order.customerId !== customer.id) throw new Error("الطلب المرتبط يخص ملف عميل آخر ولا يمكن تغيير الرابط من Inbox.");
  }
  await db.update(inboxConversations).set({ customerId: customer.id, contactNameSnapshot: conversation.contactNameSnapshot || customer.displayName, contactPhoneSnapshot: conversation.contactPhoneSnapshot || customer.phoneDisplay }).where(eq(inboxConversations.id, conversation.id));
  await appendConversationEvent(db, { storeId: input.storeId, conversationId: conversation.id, type: "customer_linked", actorUserId: input.actorUserId, fromValue: conversation.customerId ? String(conversation.customerId) : null, toValue: String(customer.id) });
  await appendInboxCustomerActivity(db, { storeId: input.storeId, customerId: customer.id, title: "رُبطت محادثة في Inbox بملف العميل", actorUserId: input.actorUserId });
}

export async function linkInboxConversationOrder(input: { storeId: number; conversationId: number; orderId: number; actorUserId: number }) {
  const db = await requireDb();
  const conversation = await getScopedConversation(db, input.storeId, input.conversationId);
  const order = await getScopedOrder(db, input.storeId, input.orderId);
  if (conversation.customerId && order.customerId !== conversation.customerId) throw new Error("لا يمكن ربط طلب يخص ملف عميل مختلف بالمحادثة الحالية.");
  await db.update(inboxConversations).set({ orderId: order.id, customerId: conversation.customerId ?? order.customerId ?? null }).where(eq(inboxConversations.id, conversation.id));
  await appendConversationEvent(db, { storeId: input.storeId, conversationId: conversation.id, type: "order_linked", actorUserId: input.actorUserId, fromValue: conversation.orderId ? String(conversation.orderId) : null, toValue: String(order.id) });
  await appendInboxCustomerActivity(db, { storeId: input.storeId, customerId: conversation.customerId ?? order.customerId, title: `رُبطت محادثة في Inbox بالطلب ${order.orderNumber}`, actorUserId: input.actorUserId });
}
