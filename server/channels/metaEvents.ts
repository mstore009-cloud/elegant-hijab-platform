import { and, asc, desc, eq, inArray, isNull, like, lte, or } from "drizzle-orm";
import { channelAccounts, channelWebhookEvents, customerBotSettings, inboxConversations, inboxMessageReactions, inboxMessages, metaAssets, metaWebhookRetrySettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { analyzeCustomerMessageImage } from "../customerBot/imageAnalysis";
import { ingestMetaLeadCapture } from "../crm/db";
import { getMetaAssetAccessToken } from "../integrations/meta/db";
import { getMetaRuntimeSettings } from "../integrations/meta/platformSettings";
import { generateCustomerBotDraft } from "../customerBot/db";
import { applyExternalDeliveryStatus, ingestExternalInboundMessage, type ExternalChannel, type ExternalMediaReference, type NormalizedInboundMessage, type NormalizedMessageMetadata } from "./db";
import { storeInboundImageFromProvider } from "./media";

type DeliveryEvent = { kind: "delivery_status"; channel: ExternalChannel; providerAccountId: string; externalEventId: string; externalMessageId: string; status: "sent" | "delivered" | "read" | "failed"; occurredAt: Date; errorSummary?: string | null };
type ReactionEvent = { kind: "reaction"; channel: ExternalChannel; providerAccountId: string; externalEventId: string; targetExternalMessageId: string; actorExternalId: string; actorDisplayName?: string | null; emoji?: string | null; action: "added" | "removed"; occurredAt: Date; source?: "live_webhook" | "historical_sync" };
type BusinessEvent = { kind: "comment" | "mention" | "lead" | "publish_status" | "unsupported" | "account_event"; channel: ExternalChannel; providerAccountId: string; externalEventId: string; occurredAt: Date; summary: string; data: Record<string, string | number | boolean | null> };
export type NormalizedMetaEvent = ({ kind: "message" } & NormalizedInboundMessage) | DeliveryEvent | ReactionEvent | BusinessEvent;

function compact(value: unknown, max = 255) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function dateFromSeconds(value: unknown) { const number = Number(value); const date = Number.isFinite(number) && number > 0 ? new Date(number * 1000) : new Date(); return Number.isNaN(date.getTime()) ? new Date() : date; }
function dateFromMilliseconds(value: unknown) { const number = Number(value); const date = Number.isFinite(number) && number > 0 ? new Date(number) : new Date(); return Number.isNaN(date.getTime()) ? new Date() : date; }
function mediaFromMessage(message: any): ExternalMediaReference[] {
  const directTypes = ["image", "video", "audio", "document"] as const;
  for (const type of directTypes) {
    const payload = message?.[type];
    if (payload?.id) return [{ providerMediaId: compact(payload.id), mediaType: type, mimeType: compact(payload.mime_type || payload.mimeType, 120) || null, originalFileName: compact(payload.filename || payload.file_name, 255) || null }];
  }
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  return attachments.map((attachment: any) => {
    const rawType = compact(attachment?.type, 32).toLowerCase();
    const mediaType = directTypes.includes(rawType as typeof directTypes[number]) ? rawType as typeof directTypes[number] : "unsupported";
    const url = compact(attachment?.payload?.url, 2000);
    const mimeType = compact(attachment?.payload?.mime_type || attachment?.mime_type, 120) || null;
    return { providerMediaId: compact(attachment?.payload?.id) || null, mediaType, mimeType, originalFileName: compact(attachment?.payload?.filename || attachment?.payload?.file_name, 255) || null, sourceUrl: url || null } as ExternalMediaReference;
  });
}

function metadataFromMessage(message: any, channel: ExternalChannel): NormalizedMessageMetadata {
  const reply = message?.context || message?.reply_to || {};
  const replyToExternalMessageId = compact(reply?.id || reply?.mid || reply?.message_id, 255) || null;
  const replyToBodyPreview = compact(reply?.quoted_message?.text || reply?.message?.text || reply?.text, 300) || null;
  const storyId = compact(reply?.story?.id || reply?.story_id || message?.story_id, 255) || null;
  const rawMentions = Array.isArray(message?.mentions) ? message.mentions : Array.isArray(message?.tagged_users) ? message.tagged_users : [];
  const mentions = rawMentions.slice(0, 20).map((mention: any) => ({ id: compact(mention?.id || mention?.user_id, 255), name: compact(mention?.name || mention?.username, 160) || null })).filter((mention: { id: string }) => mention.id);
  const messageType = compact(message?.type, 40) || (message?.text ? "text" : message?.image ? "image" : message?.attachments?.length ? "attachment" : "unsupported");
  return { messageType, replyToExternalMessageId, replyToBodyPreview, storyId, mentions, unsupportedReason: messageType === "unsupported" || messageType === "attachment" ? `نوع رسالة ${channel} يحتاج عرضاً خاصاً: ${messageType}` : null };
}

export function normalizeMetaEvents(payload: any): NormalizedMetaEvent[] {
  const events: NormalizedMetaEvent[] = [];
  if (payload?.object === "whatsapp_business_account") {
    for (const entry of Array.isArray(payload.entry) ? payload.entry : []) for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value; const accountId = compact(value?.metadata?.phone_number_id); const field = compact(change?.field, 80);
      const contacts = new Map<string, string>((Array.isArray(value?.contacts) ? value.contacts : []).map((item: any): [string, string] => [compact(item?.wa_id), compact(item?.profile?.name, 160)]));
      for (const message of field === "smb_message_echoes" ? [] : Array.isArray(value?.messages) ? value.messages : []) {
        const id = compact(message?.id); const sender = compact(message?.from); const recipient = compact(message?.to || message?.recipient_id || message?.recipient?.id || message?.recipient?.wa_id); if (!accountId || !id || !sender) continue;
        if (message?.type === "reaction" && message?.reaction?.message_id) {
          const emoji = compact(message.reaction.emoji, 32) || null;
          events.push({ kind: "reaction", channel: "whatsapp", providerAccountId: accountId, externalEventId: `reaction:${id}`, targetExternalMessageId: compact(message.reaction.message_id, 255), actorExternalId: sender, actorDisplayName: contacts.get(sender) || null, emoji, action: emoji ? "added" : "removed", occurredAt: dateFromSeconds(message?.timestamp) });
          continue;
        }
        const isEcho = Boolean(message?.is_echo || message?.echo || message?.direction === "outbound") && Boolean(recipient);
        events.push({ kind: "message", channel: "whatsapp", providerAccountId: accountId, externalEventId: isEcho ? `echo:${id}` : id, externalConversationId: `whatsapp:${accountId}:${isEcho ? recipient : sender}`, externalMessageId: id, senderName: isEcho ? null : contacts.get(sender) || null, senderPhone: isEcho ? recipient : sender, body: compact(message?.text?.body, 20_000) || compact(message?.image?.caption, 20_000) || null, occurredAt: dateFromSeconds(message?.timestamp), attachments: mediaFromMessage(message), metadata: metadataFromMessage(message, "whatsapp"), direction: isEcho ? "outbound" : undefined, source: isEcho ? "live_webhook" : undefined });
      }
      const echoes = Array.isArray(value?.smb_message_echoes) ? value.smb_message_echoes : Array.isArray(value?.echoes) ? value.echoes : field === "smb_message_echoes" && Array.isArray(value?.messages) ? value.messages : [];
      for (const message of echoes) {
        const id = compact(message?.id); const recipient = compact(message?.to || message?.recipient_id || message?.recipient?.id || message?.recipient?.wa_id); if (!accountId || !id || !recipient) continue;
        events.push({ kind: "message", channel: "whatsapp", providerAccountId: accountId, externalEventId: `echo:${id}`, externalConversationId: `whatsapp:${accountId}:${recipient}`, externalMessageId: id, senderName: null, senderPhone: recipient, body: compact(message?.text?.body, 20_000) || compact(message?.image?.caption, 20_000) || null, occurredAt: dateFromSeconds(message?.timestamp), attachments: mediaFromMessage(message), metadata: metadataFromMessage(message, "whatsapp"), direction: "outbound", source: "live_webhook" });
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
        if (accountId && messageId && sender && message?.reaction && (message.reaction.mid || message.reaction.message_id)) events.push({ kind: "reaction", channel, providerAccountId: accountId, externalEventId: `reaction:${messageId}`, targetExternalMessageId: compact(message.reaction.mid || message.reaction.message_id, 255), actorExternalId: sender, actorDisplayName: null, emoji: compact(message.reaction.emoji || message.reaction.reaction, 32) || null, action: compact(message.reaction.action, 32) === "unreact" ? "removed" : "added", occurredAt: dateFromMilliseconds(envelope?.timestamp) });
        else if (accountId && messageId && (sender || message?.is_echo)) {
          const isEcho = Boolean(message?.is_echo);
          const conversationParty = compact(isEcho ? envelope?.recipient?.id : sender);
          if (!conversationParty) continue;
          events.push({ kind: "message", channel, providerAccountId: accountId, externalEventId: `message:${isEcho ? "echo:" : ""}${messageId}`, externalConversationId: `${channel}:${accountId}:${conversationParty}`, externalMessageId: messageId, senderName: null, senderPhone: null, body: compact(message?.text, 20_000) || null, occurredAt: dateFromMilliseconds(envelope?.timestamp), attachments: mediaFromMessage(message), metadata: metadataFromMessage(message, channel), direction: isEcho ? "outbound" : undefined, source: isEcho ? "live_webhook" : undefined });
        }
        for (const deliveredId of Array.isArray(envelope?.delivery?.mids) ? envelope.delivery.mids : []) { const id = compact(deliveredId); if (accountId && id) events.push({ kind: "delivery_status", channel, providerAccountId: accountId, externalEventId: `delivery:${id}:${compact(envelope?.delivery?.watermark)}`, externalMessageId: id, status: "delivered", occurredAt: dateFromMilliseconds(envelope?.delivery?.watermark) }); }
      }
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const field = compact(change?.field, 64); const value = change?.value || {}; const externalId = compact(value?.comment_id || value?.leadgen_id || value?.media_id || value?.post_id || value?.id);
        if (!accountId || !externalId) continue;
        const kind: BusinessEvent["kind"] = field.includes("lead") ? "lead" : field.includes("mention") ? "mention" : field.includes("comment") || field === "feed" ? "comment" : field.includes("publish") ? "publish_status" : "unsupported";
        const fieldData = Array.isArray(value?.field_data) ? value.field_data : [];
        const readField = (names: string[]) => { const item = fieldData.find((candidate: any) => names.includes(compact(candidate?.name, 80).toLowerCase())); const values = Array.isArray(item?.values) ? item.values : []; return compact(values[0], 255) || null; };
        events.push({ kind, channel, providerAccountId: accountId, externalEventId: `${kind}:${externalId}`, occurredAt: dateFromSeconds(value?.created_time || value?.timestamp), summary: compact(value?.message || value?.text || field, 500) || kind, data: { objectId: externalId, parentId: compact(value?.post_id || value?.media_id) || null, senderId: compact(value?.from?.id || value?.user_id) || null, verb: compact(value?.verb, 64) || null, formId: compact(value?.form_id) || null, name: readField(["full_name", "name", "الاسم"]), phone: readField(["phone_number", "phone", "mobile", "الهاتف"]), consent: readField(["consent", "marketing_consent", "موافقة"]) } });
      }
    }
  }
  return events;
}

async function requireDb() { const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا."); return db; }
function isDuplicate(error: unknown) { const values = [error, error && typeof error === "object" && "cause" in error ? (error as any).cause : null]; return values.some(value => String((value as any)?.code || "") === "ER_DUP_ENTRY" || String((value as any)?.message || value).includes("Duplicate")); }
function safeEventJson(event: NormalizedMetaEvent) { return JSON.stringify(event, (key, value) => key === "sourceUrl" ? undefined : value).slice(0, 60_000); }
function reviveEvent(json: string): NormalizedMetaEvent { const event = JSON.parse(json); event.occurredAt = new Date(event.occurredAt); return event; }

async function ingestMetaReaction(db: any, storeId: number, event: ReactionEvent) {
  const target = await db.select({ id: inboxMessages.id, conversationId: inboxMessages.conversationId }).from(inboxMessages).innerJoin(inboxConversations, eq(inboxMessages.conversationId, inboxConversations.id)).where(and(eq(inboxConversations.storeId, storeId), eq(inboxConversations.channel, event.channel), like(inboxConversations.externalConversationId, `${event.channel}:${event.providerAccountId}:%`), eq(inboxMessages.externalMessageId, event.targetExternalMessageId))).limit(1);
  let message = target[0];
  if (!message) {
    const [fallback] = await db.select({ id: inboxMessages.id, conversationId: inboxMessages.conversationId }).from(inboxMessages).innerJoin(inboxConversations, eq(inboxMessages.conversationId, inboxConversations.id)).where(and(eq(inboxConversations.storeId, storeId), eq(inboxConversations.channel, event.channel), eq(inboxConversations.externalConversationId, `${event.channel}:${event.providerAccountId}:${event.actorExternalId}`))).orderBy(desc(inboxMessages.occurredAt), desc(inboxMessages.id)).limit(1);
    message = fallback;
  }
  if (!message) throw new Error("تعذر ربط التفاعل برسالة محفوظة؛ ستُعاد المحاولة بعد وصول الرسالة المستهدفة.");
  try {
    await db.insert(inboxMessageReactions).values({ storeId, messageId: message.id, externalEventId: event.externalEventId, targetExternalMessageId: event.targetExternalMessageId, actorExternalId: event.actorExternalId, actorDisplayName: event.actorDisplayName || null, emoji: event.emoji || null, action: event.action, source: event.source || "live_webhook", occurredAt: event.occurredAt });
    return { duplicate: false, messageId: message.id, conversationId: message.conversationId };
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    return { duplicate: true, messageId: message.id, conversationId: message.conversationId };
  }
}

async function ingestMetaBusinessEvent(db: any, storeId: number, event: BusinessEvent & { kind: "comment" | "mention" }) {
  const objectId = compact(event.data.objectId, 255);
  if (!objectId) return { conversationId: null, messageId: null, duplicate: false };
  const externalConversationId = `${event.channel}:comment:${objectId}`;
  let [conversation] = await db.select().from(inboxConversations).where(and(eq(inboxConversations.storeId, storeId), eq(inboxConversations.channel, event.channel), eq(inboxConversations.externalConversationId, externalConversationId))).limit(1);
  if (!conversation) {
    try {
      const inserted = await db.insert(inboxConversations).values({ storeId: storeId, channel: event.channel, externalConversationId, contactNameSnapshot: "Meta comment", contactPhoneSnapshot: null, subject: `تعليق ${event.channel === "instagram" ? "Instagram" : "Messenger"}`, status: "open", priority: false, lastMessageAt: event.occurredAt });
      [conversation] = await db.select().from(inboxConversations).where(eq(inboxConversations.id, Number(inserted[0].insertId))).limit(1);
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      [conversation] = await db.select().from(inboxConversations).where(and(eq(inboxConversations.storeId, storeId), eq(inboxConversations.channel, event.channel), eq(inboxConversations.externalConversationId, externalConversationId))).limit(1);
    }
  }
  if (!conversation) return { conversationId: null, messageId: null, duplicate: false };
  const metadata = JSON.stringify({ messageType: event.kind, commentExternalId: objectId, parentExternalId: compact(event.data.parentId, 255) || null });
  try {
    const inserted = await db.insert(inboxMessages).values({ conversationId: conversation.id, direction: "inbound", body: event.summary.slice(0, 20_000), metadataJson: metadata.slice(0, 8_000), externalMessageId: event.externalEventId, source: "live_webhook", occurredAt: event.occurredAt });
    await db.update(inboxConversations).set({ lastMessageAt: event.occurredAt, status: "open", updatedAt: new Date() }).where(and(eq(inboxConversations.id, conversation.id), eq(inboxConversations.storeId, storeId)));
    return { conversationId: conversation.id, messageId: Number(inserted[0].insertId), duplicate: false };
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    const [existing] = await db.select({ id: inboxMessages.id }).from(inboxMessages).where(and(eq(inboxMessages.conversationId, conversation.id), eq(inboxMessages.externalMessageId, event.externalEventId))).limit(1);
    return { conversationId: conversation.id, messageId: existing?.id ?? null, duplicate: true };
  }
}


async function resolveBinding(event: NormalizedMetaEvent) {
  const db = await requireDb();
  if (event.kind === "message" || event.kind === "delivery_status") {
    const [account] = await db.select().from(channelAccounts).where(and(eq(channelAccounts.channel, event.channel), eq(channelAccounts.providerAccountId, event.providerAccountId), inArray(channelAccounts.connectionStatus, ["testing", "connected"]))).limit(1);
    return account ? { storeId: account.storeId, channelAccountId: account.id, metaAssetId: null } : null;
  }
  const [asset] = await db.select().from(metaAssets).where(and(eq(metaAssets.externalId, event.providerAccountId), eq(metaAssets.isSelected, true))).limit(1);
  return asset ? { storeId: asset.storeId, channelAccountId: null, metaAssetId: asset.id } : null;
}

async function hydrateLeadFromGraph(row: { storeId: number; metaAssetId?: number | null }, event: BusinessEvent & { kind: "lead" }) {
  if (event.data.phone || !row.metaAssetId) return event;
  const db = await requireDb();
  const [asset] = await db.select({ connectionId: metaAssets.connectionId, externalId: metaAssets.externalId }).from(metaAssets).where(and(eq(metaAssets.id, row.metaAssetId), eq(metaAssets.storeId, row.storeId), eq(metaAssets.isSelected, true))).limit(1);
  if (!asset) return event;
  const accessToken = await getMetaAssetAccessToken({ storeId: row.storeId, connectionId: asset.connectionId, assetId: row.metaAssetId });
  const runtime = await getMetaRuntimeSettings();
  const endpoint = new URL(`https://graph.facebook.com/${runtime.graphApiVersion}/${encodeURIComponent(String(event.data.objectId))}`);
  endpoint.searchParams.set("fields", "field_data,form_id,ad_id,created_time");
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(String(payload?.error?.message || "تعذر جلب تفاصيل Lead Ads من Meta."));
  const fieldData = Array.isArray(payload?.field_data) ? payload.field_data : [];
  const readField = (names: string[]) => { const item = fieldData.find((candidate: any) => names.includes(compact(candidate?.name, 80).toLowerCase())); const values = Array.isArray(item?.values) ? item.values : []; return compact(values[0], 255) || null; };
  return { ...event, data: { ...event.data, formId: compact(payload?.form_id, 255) || event.data.formId, parentId: compact(payload?.ad_id, 255) || event.data.parentId, name: readField(["full_name", "name", "الاسم"]), phone: readField(["phone_number", "phone", "mobile", "الهاتف"]), consent: readField(["consent", "marketing_consent", "موافقة"]) } };
}

async function processReservedEvent(row: { id: number; storeId: number; metaAssetId?: number | null; payloadHash: string; attemptCount: number }, event: NormalizedMetaEvent) {
  const db = await requireDb();
  try {
    if (event.kind === "message") {
      const ingested = await ingestExternalInboundMessage({ ...event, payloadHash: row.payloadHash, reservedWebhookEventId: row.id });
      if (ingested.accepted && !ingested.duplicate && ingested.storeId) for (let index = 0; index < event.attachments.length; index += 1) {
        const mediaId = ingested.mediaIds[index]; const media = event.attachments[index]; if (!mediaId) continue;
        const stored = await storeInboundImageFromProvider({ storeId: ingested.storeId, mediaId, sourceUrl: media.sourceUrl });
        if (stored.status === "stored" && media.mediaType === "image") await analyzeCustomerMessageImage({ storeId: ingested.storeId, mediaId });
      }
      if (event.source === "live_webhook" && event.direction !== "outbound" && ingested.accepted && !ingested.duplicate && ingested.storeId && ingested.conversationId && ingested.messageId) {
        void generateCustomerBotDraft({ storeId: ingested.storeId, conversationId: ingested.conversationId, sourceMessageId: ingested.messageId }).catch(error => console.warn("[CustomerBot] تعذر تشغيل البوت بعد الرسالة الواردة:", error));
      }
    } else if (event.kind === "reaction") {
      await ingestMetaReaction(db, row.storeId, event);
    } else if (event.kind === "comment" || event.kind === "mention") {
      const ingested = await ingestMetaBusinessEvent(db, row.storeId, event as BusinessEvent & { kind: "comment" | "mention" });
      if (!ingested.duplicate && ingested.conversationId && ingested.messageId) {
        const [botSettings] = await db.select({ enabled: customerBotSettings.enabled }).from(customerBotSettings).where(eq(customerBotSettings.storeId, row.storeId)).limit(1);
        if (botSettings?.enabled) void generateCustomerBotDraft({ storeId: row.storeId, conversationId: ingested.conversationId, sourceMessageId: ingested.messageId }).catch(error => console.warn("[CustomerBot] تعذر تشغيل البوت بعد تعليق Meta:", error));
      }
    } else if (event.kind === "lead") {
      const lead = await hydrateLeadFromGraph(row, event as BusinessEvent & { kind: "lead" });
      const consent = compact(lead.data.consent, 40).toLowerCase();
      await ingestMetaLeadCapture(db, { storeId: row.storeId, metaAssetId: row.metaAssetId ?? null, externalLeadId: compact(lead.data.objectId, 255), formId: compact(lead.data.formId, 255) || null, adId: compact(lead.data.parentId, 255) || null, name: compact(lead.data.name, 160) || null, phone: compact(lead.data.phone, 40) || null, consentStatus: consent === "yes" || consent === "true" ? "granted" : consent === "no" || consent === "false" ? "denied" : "unknown", receivedAt: lead.occurredAt });
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
  const result = await processReservedEvent({ id: eventId, storeId: binding.storeId, metaAssetId: binding.metaAssetId, payloadHash, attemptCount: 0 }, event);
  return { accepted: true as const, duplicate: false as const, eventId, ...result };
}

export async function retryDueMetaEvents(limit = 20) {
  const db = await requireDb();
  const rows = await db.select().from(channelWebhookEvents).where(and(eq(channelWebhookEvents.processingStatus, "retry_pending"), or(lte(channelWebhookEvents.nextAttemptAt, new Date()), isNull(channelWebhookEvents.nextAttemptAt)))).orderBy(asc(channelWebhookEvents.nextAttemptAt)).limit(Math.max(1, Math.min(limit, 100)));
  const results = [];
  let missingPayloadDeadLetters = 0;
  for (const row of rows) {
    if (!row.normalizedPayloadJson) { await db.update(channelWebhookEvents).set({ processingStatus: "dead_letter", deadLetterAt: new Date(), errorSummary: "لا توجد حمولة مطبعة لإعادة المعالجة." }).where(eq(channelWebhookEvents.id, row.id)); missingPayloadDeadLetters += 1; continue; }
    results.push(await processReservedEvent({ id: row.id, storeId: row.storeId, metaAssetId: row.metaAssetId, payloadHash: row.payloadHash, attemptCount: row.attemptCount }, reviveEvent(row.normalizedPayloadJson)));
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
