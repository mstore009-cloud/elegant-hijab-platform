import crypto from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { metaHistorySyncJobs, metaWhatsAppHistoryChunks } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { ingestExternalInboundMessage } from "../../channels/db";
import { getWhatsAppOnboardingByPhone, getWhatsAppOnboardingByWaba, markWhatsAppHistoryDeclined, markWhatsAppOffboarded, recordWhatsAppHistoryProgress } from "./whatsappCoexistence";

async function requireDb() { const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا."); return db; }
function compact(value: unknown, max = 255) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function dateFromSeconds(value: unknown) { const number = Number(value); const date = Number.isFinite(number) && number > 0 ? new Date(number * 1000) : new Date(); return Number.isNaN(date.getTime()) ? new Date() : date; }
function isDuplicate(error: unknown): boolean {
  if (!error) return false;
  const candidate = error as any;
  return String(candidate?.code || "") === "ER_DUP_ENTRY" || String(candidate?.message || error).includes("Duplicate") || isDuplicate(candidate?.cause);
}
function historyMessageBody(message: any) {
  return compact(message?.text?.body, 20_000)
    || compact(message?.image?.caption, 20_000)
    || compact(message?.video?.caption, 20_000)
    || compact(message?.document?.caption, 20_000)
    || compact(message?.button?.text, 20_000)
    || compact(message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title, 20_000)
    || `[رسالة WhatsApp تاريخية: ${compact(message?.type, 40) || "غير معروفة"}]`;
}

export async function enqueueWhatsAppCoexistencePayload(payload: any) {
  if (payload?.object !== "whatsapp_business_account") return { handled: 0, queued: 0, duplicates: 0 };
  const db = await requireDb();
  let handled = 0; let queued = 0; let duplicates = 0;
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    const wabaId = compact(entry?.id);
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const field = compact(change?.field, 80); const value = change?.value || {};
      if (field === "account_update") {
        const event = compact(value?.event || value?.type || value?.status, 120).toUpperCase();
        if (wabaId && ["PARTNER_REMOVED", "ACCOUNT_DELETED", "OFFBOARDED", "DISABLED_UPDATE"].some(item => event.includes(item))) await markWhatsAppOffboarded(wabaId, event);
        handled += 1; continue;
      }
      if (field !== "history") continue;
      const phoneNumberId = compact(value?.metadata?.phone_number_id);
      const onboarding = phoneNumberId ? await getWhatsAppOnboardingByPhone(phoneNumberId) : wabaId ? await getWhatsAppOnboardingByWaba(wabaId) : null;
      if (!onboarding) continue;
      for (const history of Array.isArray(value?.history) ? value.history : []) {
        handled += 1;
        const errors = Array.isArray(history?.errors) ? history.errors : [];
        if (errors.some((error: any) => Number(error?.code) === 2593109)) {
          await markWhatsAppHistoryDeclined(onboarding.id, compact(errors[0]?.message, 500) || "رفض المتجر مشاركة سجل WhatsApp.");
          await db.update(metaHistorySyncJobs).set({ status: "unsupported", lastError: "رفض المتجر مشاركة سجل WhatsApp." }).where(and(eq(metaHistorySyncJobs.storeId, onboarding.storeId), eq(metaHistorySyncJobs.channel, "whatsapp"), eq(metaHistorySyncJobs.providerAccountId, onboarding.phoneNumberId)));
          continue;
        }
        const phase = Math.max(0, Math.min(2, Number(history?.metadata?.phase ?? history?.phase ?? 0) || 0));
        const chunkOrder = Math.max(0, Number(history?.metadata?.chunk_order ?? history?.chunk_order ?? 0) || 0);
        const progress = Math.max(0, Math.min(100, Number(history?.metadata?.progress ?? history?.progress ?? 0) || 0));
        const payloadJson = JSON.stringify({ phoneNumberId: onboarding.phoneNumberId, history });
        const payloadHash = crypto.createHash("sha256").update(payloadJson).digest("hex");
        try {
          await db.insert(metaWhatsAppHistoryChunks).values({ storeId: onboarding.storeId, onboardingId: onboarding.id, phase, chunkOrder, progress, payloadHash, payloadJson, status: "pending" });
          queued += 1;
        } catch (error) { if (isDuplicate(error)) duplicates += 1; else throw error; }
      }
    }
  }
  return { handled, queued, duplicates };
}

async function processWhatsAppHistoryChunk(chunkId: number) {
  const db = await requireDb();
  const [chunk] = await db.select().from(metaWhatsAppHistoryChunks).where(eq(metaWhatsAppHistoryChunks.id, chunkId)).limit(1);
  if (!chunk || !["pending", "retry_pending", "processing"].includes(chunk.status) || !chunk.payloadJson) return { processed: false, reason: "inactive" as const };
  await db.update(metaWhatsAppHistoryChunks).set({ status: "processing", lastError: null }).where(eq(metaWhatsAppHistoryChunks.id, chunk.id));
  try {
    const payload = JSON.parse(chunk.payloadJson) as any;
    const phoneNumberId = compact(payload?.phoneNumberId);
    const history = payload?.history || {};
    let imported = 0; let duplicates = 0; let oldest: Date | null = null; let newest: Date | null = null;
    for (const thread of Array.isArray(history?.threads) ? history.threads : []) {
      const customerId = compact(thread?.id); if (!customerId) continue;
      for (const message of Array.isArray(thread?.messages) ? thread.messages : []) {
        const messageId = compact(message?.id); if (!messageId) continue;
        const occurredAt = dateFromSeconds(message?.timestamp);
        const sender = compact(message?.from); const direction = sender === customerId ? "inbound" as const : "outbound" as const;
        const result = await ingestExternalInboundMessage({ channel: "whatsapp", providerAccountId: phoneNumberId, externalEventId: `history:${messageId}`, externalConversationId: `whatsapp:${customerId}`, externalMessageId: messageId, senderName: null, senderPhone: customerId, body: historyMessageBody(message), occurredAt, attachments: [], direction, source: "historical_sync", payloadHash: chunk.payloadHash });
        const duplicate = "duplicate" in result && result.duplicate;
        if (result.accepted && !duplicate) imported += 1; if (duplicate) duplicates += 1;
        if (!oldest || occurredAt < oldest) oldest = occurredAt; if (!newest || occurredAt > newest) newest = occurredAt;
      }
    }
    await recordWhatsAppHistoryProgress({ onboardingId: chunk.onboardingId, progress: chunk.progress, phase: chunk.phase, chunkOrder: chunk.chunkOrder, oldestMessageAt: oldest, newestMessageAt: newest });
    const [job] = await db.select().from(metaHistorySyncJobs).where(and(eq(metaHistorySyncJobs.storeId, chunk.storeId), eq(metaHistorySyncJobs.channel, "whatsapp"), eq(metaHistorySyncJobs.providerAccountId, phoneNumberId))).limit(1);
    if (job) await db.update(metaHistorySyncJobs).set({ status: chunk.progress >= 100 ? "completed" : "running", stage: chunk.progress >= 100 ? "complete" : "history_webhook", processedMessages: job.processedMessages + imported, duplicateMessages: job.duplicateMessages + duplicates, oldestMessageAt: !job.oldestMessageAt || (oldest && oldest < job.oldestMessageAt) ? oldest : job.oldestMessageAt, newestMessageAt: !job.newestMessageAt || (newest && newest > job.newestMessageAt) ? newest : job.newestMessageAt, lastRunAt: new Date(), completedAt: chunk.progress >= 100 ? new Date() : null, lastError: null }).where(eq(metaHistorySyncJobs.id, job.id));
    await db.update(metaWhatsAppHistoryChunks).set({ status: "processed", payloadJson: null, processedAt: new Date(), lastError: null }).where(eq(metaWhatsAppHistoryChunks.id, chunk.id));
    return { processed: true as const, imported, duplicates };
  } catch (error) {
    const attemptCount = chunk.attemptCount + 1; const dead = attemptCount >= 5; const delays = [60_000, 300_000, 900_000, 3_600_000];
    await db.update(metaWhatsAppHistoryChunks).set({ status: dead ? "dead_letter" : "retry_pending", attemptCount, nextAttemptAt: dead ? null : new Date(Date.now() + delays[Math.min(attemptCount - 1, delays.length - 1)]), lastError: compact(error instanceof Error ? error.message : error, 500) || "تعذرت معالجة دفعة WhatsApp history." }).where(eq(metaWhatsAppHistoryChunks.id, chunk.id));
    return { processed: false as const, reason: dead ? "dead_letter" as const : "retry" as const };
  }
}

export async function processDueWhatsAppHistoryChunks(limit = 2) {
  const db = await requireDb(); const now = new Date();
  const chunks = await db.select({ id: metaWhatsAppHistoryChunks.id }).from(metaWhatsAppHistoryChunks).where(or(eq(metaWhatsAppHistoryChunks.status, "pending"), and(eq(metaWhatsAppHistoryChunks.status, "retry_pending"), or(isNull(metaWhatsAppHistoryChunks.nextAttemptAt), lte(metaWhatsAppHistoryChunks.nextAttemptAt, now))))).orderBy(asc(metaWhatsAppHistoryChunks.receivedAt)).limit(Math.max(1, Math.min(limit, 5)));
  const results = []; for (const chunk of chunks) results.push(await processWhatsAppHistoryChunk(chunk.id));
  return { attempted: chunks.length, processed: results.filter(item => item.processed).length, deadLetters: results.filter(item => !item.processed && item.reason === "dead_letter").length };
}

export async function getWhatsAppHistoryChunkHealth(storeId: number) {
  const db = await requireDb();
  const rows = await db.select({ status: metaWhatsAppHistoryChunks.status }).from(metaWhatsAppHistoryChunks).where(eq(metaWhatsAppHistoryChunks.storeId, storeId));
  return { total: rows.length, pending: rows.filter(row => row.status === "pending").length, retryPending: rows.filter(row => row.status === "retry_pending").length, deadLetters: rows.filter(row => row.status === "dead_letter").length };
}
