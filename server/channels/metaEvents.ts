import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { channelAccounts, channelWebhookEvents, metaAssets, metaWebhookRetrySettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { analyzeCustomerMessageImage } from "../customerBot/imageAnalysis";
import { applyExternalDeliveryStatus, ingestExternalInboundMessage, type ExternalChannel, type ExternalMediaReference, type NormalizedInboundMessage } from "./db";
import { storeInboundImageFromProvider } from "./media";

type DeliveryEvent = { kind: "delivery_status"; channel: ExternalChannel; providerAccountId: string; externalEventId: string; externalMessageId: string; status: "sent" | "delivered" | "read" | "failed"; occurredAt: Date; errorSummary?: string | null };
type BusinessEvent = { kind: "comment" | "mention" | "lead" | "publish_status" | "unsupported" | "account_event"; providerAccountId: string; externalEventId: string; occurredAt: Date; summary: string; data: Record<string, string | number | boolean | null> };
export type NormalizedMetaEvent = ({ kind: "message" } & NormalizedInboundMessage) | DeliveryEvent | BusinessEvent;

function compact(value: unknown, max = 255) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function dateFromSeconds(value: unknown) { const number = Number(value); const date = Number.isFinite(number) && number > 0 ? new Date(number * 1000) : new Date(); return Number.isNaN(date.getTime()) ? new Date() : date; }
function dateFromMilliseconds(value: unknown) { const number = Number(value); const date = Number.isFinite(number) && number > 0 ? new Date(number) : new Date(); return Number.isNaN(date.getTime()) ? new Date() : date; }
function mediaFromMessage(message: any): ExternalMediaReference[] {
  if (message?.image?.id) return [{ providerMediaId: compact(message.image.id), mediaType: "image", mimeType: compact(message.image.mime_type, 120) || "image/jpeg", originalFileName: null }];
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  return attachments.map((attachment: any) => { const url = compact(attachment?.payload?.url, 2000); const image = compact(attachment?.type, 32) === "image" && url; return { providerMediaId: compact(attachment?.payload?.id) || null, mediaType: image ? "image" : "unsupported", mimeType: image ? "image/jpeg" : null, originalFileName: null, sourceUrl: url || null } as ExternalMediaReference; });
}

export function normalizeMetaEvents(payload: any): NormalizedMetaEvent[] {
  const events: NormalizedMetaEvent[] = [];
  if (payload?.object === "whatsapp_business_account") {
    for (const entry of Array.isArray(payload.entry) ? payload.entry : []) for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value; const accountId = compact(value?.metadata?.phone_number_id); const field = compact(change?.field, 80);
      const contacts = new Map<string, string>((Array.isArray(value?.contacts) ? value.contacts : []).map((item: any): [string, string] => [compact(item?.wa_id), compact(item?.profile?.name, 160)]));
      for (const message of field === "smb_message_echoes" ? [] : Array.isArray(value?.messages) ? value.messages : []) {
        const id = compact(message?.id); const sender = compact(message?.from); if (!accountId || !id || !sender) continue;
        events.push({ kind: "message", channel: "whatsapp", providerAccountId: accountId, externalEventId: id, externalConversationId: `whatsapp:${sender}`, externalMessageId: id, senderName: contacts.get(sender) || null, senderPhone: sender, body: compact(message?.text?.body, 20_000) || compact(message?.image?.caption, 20_000) || null, occurredAt: dateFromSeconds(message?.timestamp), attachments: mediaFromMessage(message) });
      }
      const echoes = Array.isArray(value?.smb_message_echoes) ? value.smb_message_echoes : field === "smb_message_echoes" && Array.isArray(value?.messages) ? value.messages : [];
      for (const message of echoes) {
        const id = compact(message?.id); const recipient = compact(message?.to); if (!accountId || !id || !recipient) continue;
        events.push({ kind: "message", channel: "whatsapp", providerAccountId: accountId, externalEventId: `echo:${id}`, externalConversationId: `whatsapp:${recipient}`, externalMessageId: id, senderName: null, senderPhone: recipient, body: compact(message?.text?.body, 20_000) || compact(message?.image?.caption, 20_000) || null, occurredAt: dateFromSeconds(message?.timestamp), attachments: mediaFromMessage(message), direction: "outbound", source: "live_webhook" });
      }
      for (const status of Array.isArray(value?.statuses) ? value.statuses : []) {
        const id = compact(status?.id); const raw = compact(status?.status, 32); const mapped = raw === "delivered" ? "delivered" : raw === "read" ? "read" : raw === "failed" ? "failed" : "sent"; if (!accountId || !id) continue;
        events.push({ kind: "delivery_status", channel: "whatsapp", providerAccountId: accountId, externalEventId: `status:${id}:${mapped}:${compact(status?.timestamp)}`, externalMessageId: id, status: mapped, occurredAt: dateFromSeconds(status?.timestamp), errorSummary: mapped === "failed" ? compact(status?.errors?.[0]?.title || status?.errors?.[0]?.message, 500) || null : null });
      }
    }
  }
  if (payload?.object === "instagram" || payload?.object === "page") {
    const channel = payload.object === "page" ? "messenger" : "instagram";
    for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
      const accountId = compact(entry?.id);
      for (const envelope of Array.isArray(entry?.messaging) ? entry.messaging : []) {
        const message = envelope?.message; const messageId = compact(message?.mid); const sender = compact(envelope?.sender?.id);
        if (accountId && messageId && sender && !message?.is_echo) events.push({ kind: "message", channel, providerAccountId: accountId, externalEventId: messageId, externalConversationId: `${channel}:${sender}`, externalMessageId: messageId, senderName: null, senderPhone: null, body: compact(message?.text, 20_000) || null, occurredAt: dateFromMilliseconds(envelope?.timestamp), attachments: mediaFromMessage(message) });
        for (const deliveredId of Array.isArray(envelope?.delivery?.mids) ? envelope.delivery.mids : []) { const id = compact(deliveredId); if (accountId && id) events.push({ kind: "delivery_status", channel, providerAccountId: accountId, externalEventId: `delivery:${id}:${compact(envelope?.delivery?.watermark)}`, externalMessageId: id, status: "delivered", occurredAt: dateFromMilliseconds(envelope?.delivery?.watermark) }); }
      }
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const field = compact(change?.field, 64); const value = change?.value || {}; const externalId = compact(value?.comment_id || value?.leadgen_id || value?.media_id || value?.post_id || value?.id);
        if (!accountId || !externalId) continue;
        const kind: BusinessEvent["kind"] = field.includes("lead") ? "lead" : field.includes("mention") ? "mention" : field.includes("comment") || field === "feed" ? "comment" : field.includes("publish") ? "publish_status" : "unsupported";
        events.push({ kind, providerAccountId: accountId, externalEventId: `${kind}:${externalId}`, occurredAt: dateFromSeconds(value?.created_time || value?.timestamp), summary: compact(value?.message || value?.text || field, 500) || kind, data: { objectId: externalId, parentId: compact(value?.post_id || value?.media_id) || null, senderId: compact(value?.from?.id || value?.user_id) || null, verb: compact(value?.verb, 64) || null, formId: compact(value?.form_id) || null } });
      }
    }
  }
  return events;
}

async function requireDb() { const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا."); return db; }
function isDuplicate(error: unknown) { const values = [error, error && typeof error === "object" && "cause" in error ? (error as any).cause : null]; return values.some(value => String((value as any)?.code || "") === "ER_DUP_ENTRY" || String((value as any)?.message || value).includes("Duplicate")); }
function safeEventJson(event: NormalizedMetaEvent) { return JSON.stringify(event, (key, value) => key === "sourceUrl" ? undefined : value).slice(0, 60_000); }
function reviveEvent(json: string): NormalizedMetaEvent { const event = JSON.parse(json); event.occurredAt = new Date(event.occurredAt); return event; }

async function resolveBinding(event: NormalizedMetaEvent) {
  const db = await requireDb();
  if (event.kind === "message" || event.kind === "delivery_status") {
    const [account] = await db.select().from(channelAccounts).where(and(eq(channelAccounts.channel, event.channel), eq(channelAccounts.providerAccountId, event.providerAccountId), inArray(channelAccounts.connectionStatus, ["testing", "connected"]))).limit(1);
    return account ? { storeId: account.storeId, channelAccountId: account.id, metaAssetId: null } : null;
  }
  const [asset] = await db.select().from(metaAssets).where(and(eq(metaAssets.externalId, event.providerAccountId), eq(metaAssets.isSelected, true))).limit(1);
  return asset ? { storeId: asset.storeId, channelAccountId: null, metaAssetId: asset.id } : null;
}

async function processReservedEvent(row: { id: number; storeId: number; payloadHash: string; attemptCount: number }, event: NormalizedMetaEvent) {
  const db = await requireDb();
  try {
    if (event.kind === "message") {
      const ingested = await ingestExternalInboundMessage({ ...event, payloadHash: row.payloadHash, reservedWebhookEventId: row.id });
      if (ingested.accepted && !ingested.duplicate && ingested.storeId) for (let index = 0; index < event.attachments.length; index += 1) {
        const mediaId = ingested.mediaIds[index]; const media = event.attachments[index]; if (!mediaId || media.mediaType !== "image") continue;
        const stored = await storeInboundImageFromProvider({ storeId: ingested.storeId, mediaId, sourceUrl: media.sourceUrl });
        if (stored.status === "stored") await analyzeCustomerMessageImage({ storeId: ingested.storeId, mediaId });
      }
    } else if (event.kind === "delivery_status") {
      await applyExternalDeliveryStatus({ storeId: row.storeId, externalMessageId: event.externalMessageId, status: event.status, occurredAt: event.occurredAt, errorSummary: event.errorSummary });
    }
    await db.update(channelWebhookEvents).set({ processingStatus: "processed", processedAt: new Date(), lastAttemptAt: new Date(), attemptCount: row.attemptCount + 1, nextAttemptAt: null, errorSummary: event.kind === "comment" || event.kind === "mention" || event.kind === "lead" || event.kind === "publish_status" ? "تم حفظ الحدث، وستعالجه الوحدة المختصة في مرحلته." : null }).where(eq(channelWebhookEvents.id, row.id));
    return { processed: true as const };
  } catch (error) {
    const attemptCount = row.attemptCount + 1; const dead = attemptCount >= 5; const delays = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
    await db.update(channelWebhookEvents).set({ processingStatus: dead ? "dead_letter" : "retry_pending", attemptCount, lastAttemptAt: new Date(), nextAttemptAt: dead ? null : new Date(Date.now() + delays[Math.min(attemptCount - 1, delays.length - 1)]), deadLetterAt: dead ? new Date() : null, errorSummary: (error instanceof Error ? error.message : "تعذرت معالجة حدث Meta.").slice(0, 500) }).where(eq(channelWebhookEvents.id, row.id));
    return { processed: false as const, deadLetter: dead };
  }
}

export async function enqueueAndProcessMetaEvent(event: NormalizedMetaEvent, payloadHash: string) {
  const db = await requireDb(); const binding = await resolveBinding(event); if (!binding) return { accepted: false as const, reason: "unlinked_account" as const };
  let eventId: number;
  try { const inserted = await db.insert(channelWebhookEvents).values({ ...binding, externalEventId: event.externalEventId, payloadHash, eventType: event.kind, processingStatus: "received", normalizedPayloadJson: safeEventJson(event) }); eventId = Number(inserted[0].insertId); }
  catch (error) { if (isDuplicate(error)) return { accepted: true as const, duplicate: true as const }; throw error; }
  const result = await processReservedEvent({ id: eventId, storeId: binding.storeId, payloadHash, attemptCount: 0 }, event);
  return { accepted: true as const, duplicate: false as const, eventId, ...result };
}

export async function retryDueMetaEvents(limit = 20) {
  const db = await requireDb();
  const rows = await db.select().from(channelWebhookEvents).where(and(eq(channelWebhookEvents.processingStatus, "retry_pending"), or(lte(channelWebhookEvents.nextAttemptAt, new Date()), isNull(channelWebhookEvents.nextAttemptAt)))).orderBy(asc(channelWebhookEvents.nextAttemptAt)).limit(Math.max(1, Math.min(limit, 100)));
  const results = [];
  let missingPayloadDeadLetters = 0;
  for (const row of rows) {
    if (!row.normalizedPayloadJson) { await db.update(channelWebhookEvents).set({ processingStatus: "dead_letter", deadLetterAt: new Date(), errorSummary: "لا توجد حمولة مطبعة لإعادة المعالجة." }).where(eq(channelWebhookEvents.id, row.id)); missingPayloadDeadLetters += 1; continue; }
    results.push(await processReservedEvent({ id: row.id, storeId: row.storeId, payloadHash: row.payloadHash, attemptCount: row.attemptCount }, reviveEvent(row.normalizedPayloadJson)));
  }
  return { attempted: rows.length, processed: results.filter(item => item.processed).length, deadLetters: missingPayloadDeadLetters + results.filter(item => !item.processed && item.deadLetter).length };
}

export async function getMetaEventHealth(storeId: number) {
  const db = await requireDb(); const rows = await db.select({ status: channelWebhookEvents.processingStatus }).from(channelWebhookEvents).where(eq(channelWebhookEvents.storeId, storeId));
  return { total: rows.length, received: rows.filter(row => row.status === "received").length, retryPending: rows.filter(row => row.status === "retry_pending").length, deadLetters: rows.filter(row => row.status === "dead_letter").length, failed: rows.filter(row => row.status === "failed").length };
}

export async function requeueMetaDeadLetters(storeId: number) {
  const db = await requireDb();
  const result = await db.update(channelWebhookEvents).set({ processingStatus: "retry_pending", attemptCount: 0, nextAttemptAt: new Date(), deadLetterAt: null, errorSummary: "أعيد الحدث للمحاولة يدوياً من مركز Meta." }).where(and(eq(channelWebhookEvents.storeId, storeId), eq(channelWebhookEvents.processingStatus, "dead_letter")));
  return Number((result as any)[0]?.affectedRows ?? 0);
}

export async function getMetaRetryStatus() {
  const db = await requireDb();
  const [row] = await db.select().from(metaWebhookRetrySettings).where(eq(metaWebhookRetrySettings.id, 1)).limit(1);
  return row ?? null;
}

export async function saveMetaRetryTaskUid(taskUid: string) {
  const db = await requireDb();
  await db.insert(metaWebhookRetrySettings).values({ id: 1, scheduleCronTaskUid: taskUid, enabled: true }).onDuplicateKeyUpdate({ set: { scheduleCronTaskUid: taskUid, enabled: true } });
}
