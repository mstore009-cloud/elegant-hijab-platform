import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { channelAccounts, metaConnections, metaHistorySyncJobs } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { ingestExternalInboundMessage, listChannelAccounts, type ExternalChannel, type ExternalMediaReference, type NormalizedMessageMetadata } from "../../channels/db";
import { storeInboundImageFromProvider } from "../../channels/media";
import { getMetaAssetAccessToken, getMetaConnection, listMetaConnectionOverview } from "./db";
import { getMetaRuntimeSettings } from "./platformSettings";

type HistoryChannel = "messenger" | "instagram";
type SyncCursor = { conversationsAfter?: string | null; conversationIndex?: number; messagesAfter?: string | null };

async function requireDb() { const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا."); return db; }
function compact(value: unknown, max = 255) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function parseDate(value: unknown) { const date = new Date(typeof value === "string" || typeof value === "number" ? value : Date.now()); return Number.isNaN(date.getTime()) ? new Date() : date; }
function parseCursor(value: string | null): SyncCursor { try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; } }
function safeCursor(value: SyncCursor) { return JSON.stringify(value).slice(0, 8000); }
function historyMessageMetadata(message: any): NormalizedMessageMetadata {
  const reply = message?.reply_to || message?.context || {};
  const messageType = compact(message?.type, 40) || (message?.message ? "text" : message?.attachments?.data?.length ? "attachment" : "unsupported");
  return {
    messageType,
    replyToExternalMessageId: compact(reply?.id || reply?.mid || reply?.message_id, 255) || null,
    replyToBodyPreview: compact(reply?.message || reply?.text, 300) || null,
    storyId: compact(reply?.story?.id || reply?.story_id || message?.story_id, 255) || null,
    mentions: Array.isArray(message?.mentions) ? message.mentions.slice(0, 20).map((mention: any) => ({ id: compact(mention?.id || mention?.user_id, 255), name: compact(mention?.name || mention?.username, 160) || null })).filter((mention: { id: string }) => mention.id) : [],
    unsupportedReason: messageType === "unsupported" || messageType === "attachment" ? `نوع رسالة تاريخية يحتاج عرضاً خاصاً: ${messageType}` : null,
  };
}

async function graphGet(path: string, token: string, params: Record<string, string>) {
  const runtime = await getMetaRuntimeSettings();
  const url = new URL(path.startsWith("https://") ? path : `https://graph.facebook.com/${runtime.graphApiVersion}/${path.replace(/^\//, "")}`);
  if (url.hostname !== "graph.facebook.com") throw new Error("رفض رابط pagination غير موثوق من Meta.");
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(35_000) });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || payload?.error) throw new Error(compact(payload?.error?.message || response.statusText || "تعذر قراءة سجل Meta", 500));
  return payload;
}

async function loadHistoryCredential(storeId: number, channel: HistoryChannel, providerAccountId: string) {
  const connection = await getMetaConnection(storeId, "unified");
  if (!connection || connection.status !== "connected") throw new Error("اتصال Meta الموحد غير متصل لهذا المتجر.");
  const overview = await listMetaConnectionOverview(storeId);
  const direct = overview.assets.find(asset => asset.connectionId === connection.id && asset.externalId === providerAccountId && asset.assetType === (channel === "messenger" ? "page" : "instagram"));
  if (!direct) throw new Error("الأصل المحدد للمزامنة غير موجود في اتصال هذا المتجر.");
  if (channel === "messenger") return { connection, graphAccountId: direct.externalId, token: await getMetaAssetAccessToken({ storeId, connectionId: connection.id, assetId: direct.id }) };
  const page = overview.assets.find(asset => asset.connectionId === connection.id && asset.assetType === "page" && asset.externalId === direct.parentExternalId);
  if (!page) throw new Error("حساب Instagram لا يملك صفحة Facebook مرتبطة برمز صالح.");
  return { connection, graphAccountId: direct.externalId, token: await getMetaAssetAccessToken({ storeId, connectionId: connection.id, assetId: page.id }) };
}

function mapAttachments(message: any): ExternalMediaReference[] {
  const rows = Array.isArray(message?.attachments?.data) ? message.attachments.data : [];
  return rows.slice(0, 10).map((item: any) => {
    const mime = compact(item?.mime_type, 120);
    const imageUrl = compact(item?.image_data?.url || item?.media_url || item?.payload?.url || item?.url, 2000);
    const declaredType = compact(item?.type || item?.media_type, 40).toLowerCase();
    const mediaType = imageUrl && (declaredType === "image" || mime.startsWith("image/") || !declaredType) ? "image" : declaredType === "video" || mime.startsWith("video/") ? "video" : declaredType === "audio" || mime.startsWith("audio/") ? "audio" : "document";
    return { providerMediaId: compact(item?.id) || null, mediaType, mimeType: mime || null, originalFileName: compact(item?.name || item?.filename, 255) || null, sourceUrl: imageUrl || null } as ExternalMediaReference;
  });
}

export async function ensureMetaHistorySyncJobs(storeId: number, actorUserId: number) {
  const db = await requireDb();
  const connection = await getMetaConnection(storeId, "unified");
  if (!connection || connection.status !== "connected") return [];
  const accounts = (await listChannelAccounts(storeId)).filter(account => account.providerAccountId && ["testing", "connected"].includes(account.connectionStatus));
  for (const account of accounts) {
    const status = account.channel === "whatsapp" ? "unsupported" as const : "pending" as const;
    const stage = account.channel === "whatsapp" ? "history_webhook" as const : "conversations" as const;
    await db.insert(metaHistorySyncJobs).values({ storeId, connectionId: connection.id, channelAccountId: account.id, channel: account.channel, providerAccountId: account.providerAccountId!, status, stage, createdByUserId: actorUserId, lastError: account.channel === "whatsapp" ? "الربط القياسي يستقبل الرسائل الجديدة فقط. يتطلب التاريخ WhatsApp Coexistence وموافقة مشاركة السجل." : null }).onDuplicateKeyUpdate({ set: { connectionId: connection.id, channelAccountId: account.id, createdByUserId: actorUserId, updatedAt: new Date() } });
  }
  return listMetaHistorySyncJobs(storeId);
}

export async function enableWhatsAppHistorySyncJob(input: { storeId: number; connectionId: number; channelAccountId: number; providerAccountId: string; actorUserId: number; coexistence: boolean }) {
  const db = await requireDb();
  const values = {
    storeId: input.storeId,
    connectionId: input.connectionId,
    channelAccountId: input.channelAccountId,
    channel: "whatsapp" as const,
    providerAccountId: input.providerAccountId,
    status: input.coexistence ? "pending" as const : "unsupported" as const,
    stage: "history_webhook" as const,
    lastError: input.coexistence ? null : "الرقم مرتبط عبر Cloud API القياسي؛ سجل WhatsApp السابق متاح فقط عند Coexistence وموافقة مشاركة التاريخ.",
    createdByUserId: input.actorUserId,
  };
  await db.insert(metaHistorySyncJobs).values(values).onDuplicateKeyUpdate({ set: values });
  const [job] = await db.select().from(metaHistorySyncJobs).where(and(eq(metaHistorySyncJobs.storeId, input.storeId), eq(metaHistorySyncJobs.channel, "whatsapp"), eq(metaHistorySyncJobs.providerAccountId, input.providerAccountId))).limit(1);
  if (!job) throw new Error("تعذر تهيئة مهمة تاريخ WhatsApp.");
  return job;
}

export async function listMetaHistorySyncJobs(storeId: number) {
  const db = await requireDb();
  return db.select().from(metaHistorySyncJobs).where(eq(metaHistorySyncJobs.storeId, storeId)).orderBy(asc(metaHistorySyncJobs.channel));
}

async function importHistoryMessage(input: { storeId: number; channel: HistoryChannel; providerAccountId: string; businessAccountId: string; customerId: string; customerName: string | null; message: any }) {
  const messageId = compact(input.message?.id); if (!messageId) return { imported: false, duplicate: false };
  const senderId = compact(input.message?.from?.id); const direction = senderId === input.businessAccountId ? "outbound" as const : "inbound" as const;
  const attachments = mapAttachments(input.message);
  const result = await ingestExternalInboundMessage({ channel: input.channel, providerAccountId: input.providerAccountId, externalEventId: `history:${messageId}`, externalConversationId: `${input.channel}:${input.providerAccountId}:${input.customerId}`, externalMessageId: messageId, senderName: input.customerName, senderPhone: null, body: compact(input.message?.message, 20_000) || null, occurredAt: parseDate(input.message?.created_time), attachments, metadata: historyMessageMetadata(input.message), direction, source: "historical_sync", payloadHash: `history:${messageId}` });
  if (result.accepted && !result.duplicate && result.storeId) for (let index = 0; index < attachments.length; index += 1) {
    if (!result.mediaIds[index]) continue;
    await storeInboundImageFromProvider({ storeId: result.storeId, mediaId: result.mediaIds[index], sourceUrl: attachments[index]?.sourceUrl }).catch(() => undefined);
  }
  const duplicate = "duplicate" in result && result.duplicate;
  return { imported: Boolean(result.accepted && !duplicate), duplicate: Boolean(duplicate), occurredAt: parseDate(input.message?.created_time) };
}

export async function processMetaHistorySyncJob(jobId: number) {
  const db = await requireDb();
  const [job] = await db.select().from(metaHistorySyncJobs).where(eq(metaHistorySyncJobs.id, jobId)).limit(1);
  if (!job || !["pending", "running", "retry_pending"].includes(job.status)) return { processed: false, reason: "inactive" as const };
  if (job.channel === "whatsapp") return { processed: false, reason: "history_webhook_only" as const };
  const channel = job.channel as HistoryChannel;
  const credential = await loadHistoryCredential(job.storeId, channel, job.providerAccountId);
  const cursor = parseCursor(job.cursor);
  await db.update(metaHistorySyncJobs).set({ status: "running", lastRunAt: new Date(), lastError: null }).where(eq(metaHistorySyncJobs.id, job.id));
  try {
    const conversations = await graphGet(`${credential.graphAccountId}/conversations`, credential.token, { platform: channel, fields: channel === "instagram" ? "id,updated_time" : "id,updated_time,participants", limit: channel === "instagram" ? "5" : "25", after: cursor.conversationsAfter || "" });
    const rows = Array.isArray(conversations?.data) ? conversations.data : [];
    const index = Math.max(0, Math.min(cursor.conversationIndex || 0, rows.length));
    const conversation = rows[index];
    if (!conversation) {
      const nextAfter = compact(conversations?.paging?.cursors?.after);
      if (nextAfter && nextAfter !== cursor.conversationsAfter) {
        await db.update(metaHistorySyncJobs).set({ status: "pending", cursor: safeCursor({ conversationsAfter: nextAfter, conversationIndex: 0 }), currentConversationExternalId: null }).where(eq(metaHistorySyncJobs.id, job.id));
        return { processed: true, completed: false, messages: 0 };
      }
      await db.update(metaHistorySyncJobs).set({ status: "completed", stage: "complete", cursor: null, currentConversationExternalId: null, completedAt: new Date(), nextAttemptAt: null }).where(eq(metaHistorySyncJobs.id, job.id));
      return { processed: true, completed: true, messages: 0 };
    }
    const participants = Array.isArray(conversation?.participants?.data) ? conversation.participants.data : [];
    const customer = participants.find((item: any) => compact(item?.id) && compact(item?.id) !== job.providerAccountId) || participants[0] || {};
    const customerId = compact(customer?.id) || compact(conversation?.id);
    const messages = await graphGet(`${compact(conversation?.id)}/messages`, credential.token, { fields: channel === "instagram" ? "id,message,created_time,from,attachments" : "id,message,created_time,from,to,attachments", limit: channel === "instagram" ? "10" : "50", after: cursor.messagesAfter || "" });
    let imported = 0; let duplicates = 0; let oldest: Date | null = job.oldestMessageAt; let newest: Date | null = job.newestMessageAt;
    for (const message of Array.isArray(messages?.data) ? messages.data : []) {
      const result = await importHistoryMessage({ storeId: job.storeId, channel, providerAccountId: job.providerAccountId, businessAccountId: job.providerAccountId, customerId, customerName: compact(customer?.name, 160) || null, message });
      if (result.imported) imported += 1; if (result.duplicate) duplicates += 1;
      if (result.occurredAt) { if (!oldest || result.occurredAt < oldest) oldest = result.occurredAt; if (!newest || result.occurredAt > newest) newest = result.occurredAt; }
    }
    const messagesAfter = compact(messages?.paging?.cursors?.after);
    const nextCursor: SyncCursor = messagesAfter ? { conversationsAfter: cursor.conversationsAfter || null, conversationIndex: index, messagesAfter } : { conversationsAfter: cursor.conversationsAfter || null, conversationIndex: index + 1, messagesAfter: null };
    await db.update(metaHistorySyncJobs).set({ status: "pending", stage: "messages", cursor: safeCursor(nextCursor), currentConversationExternalId: messagesAfter ? compact(conversation?.id) : null, processedConversations: job.processedConversations + (messagesAfter ? 0 : 1), processedMessages: job.processedMessages + imported, duplicateMessages: job.duplicateMessages + duplicates, oldestMessageAt: oldest, newestMessageAt: newest, attemptCount: 0, nextAttemptAt: null }).where(eq(metaHistorySyncJobs.id, job.id));
    return { processed: true, completed: false, messages: imported, duplicates };
  } catch (error) {
    const attemptCount = job.attemptCount + 1; const terminal = attemptCount >= 5; const delay = [60_000, 300_000, 900_000, 3_600_000][Math.min(attemptCount - 1, 3)];
    await db.update(metaHistorySyncJobs).set({ status: terminal ? "failed" : "retry_pending", attemptCount, failedItems: job.failedItems + 1, nextAttemptAt: terminal ? null : new Date(Date.now() + delay), lastError: compact(error instanceof Error ? error.message : error, 500) || "تعذرت مزامنة سجل Meta." }).where(eq(metaHistorySyncJobs.id, job.id));
    return { processed: false, reason: terminal ? "failed" as const : "retry" as const };
  }
}

export async function processDueMetaHistorySyncJobs(limit = 3) {
  const db = await requireDb(); const now = new Date();
  const jobs = await db.select({ id: metaHistorySyncJobs.id }).from(metaHistorySyncJobs).where(or(eq(metaHistorySyncJobs.status, "pending"), and(eq(metaHistorySyncJobs.status, "retry_pending"), or(isNull(metaHistorySyncJobs.nextAttemptAt), lte(metaHistorySyncJobs.nextAttemptAt, now))))).orderBy(asc(metaHistorySyncJobs.updatedAt)).limit(Math.max(1, Math.min(limit, 10)));
  const results = []; const startedAt = Date.now();
  for (const job of jobs) {
    for (let step = 0; step < 4 && Date.now() - startedAt < 95_000; step += 1) {
      const result = await processMetaHistorySyncJob(job.id);
      results.push(result);
      if (!result.processed || result.completed) break;
    }
  }
  return { attempted: jobs.length, processed: results.filter(item => item.processed).length };
}

export async function setMetaHistorySyncStatus(storeId: number, jobId: number, action: "pause" | "resume" | "retry") {
  const db = await requireDb(); const [job] = await db.select().from(metaHistorySyncJobs).where(and(eq(metaHistorySyncJobs.id, jobId), eq(metaHistorySyncJobs.storeId, storeId))).limit(1);
  if (!job) throw new Error("مهمة المزامنة غير موجودة داخل هذا المتجر.");
  if (job.status === "unsupported") throw new Error("هذه القناة لا تدعم الاستيراد التاريخي بهذا النوع من الربط.");
  const status = action === "pause" ? "paused" as const : "pending" as const;
  await db.update(metaHistorySyncJobs).set({ status, nextAttemptAt: null, lastError: action === "retry" ? null : job.lastError, attemptCount: action === "retry" ? 0 : job.attemptCount }).where(and(eq(metaHistorySyncJobs.id, jobId), eq(metaHistorySyncJobs.storeId, storeId)));
  return { id: job.id, status };
}
