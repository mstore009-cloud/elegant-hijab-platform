import { and, eq, inArray } from "drizzle-orm";
import {
  channelAccounts,
  channelWebhookEvents,
  inboxConversationEvents,
  inboxConversations,
  inboxMessageMedia,
  inboxMessages,
} from "../../drizzle/schema";
import { getDb } from "../db";

export const externalChannels = ["whatsapp", "instagram", "messenger"] as const;
export type ExternalChannel = (typeof externalChannels)[number];

export type ExternalMediaReference = {
  providerMediaId?: string | null;
  mediaType: "image" | "video" | "audio" | "document" | "unsupported";
  mimeType?: string | null;
  originalFileName?: string | null;
  sourceUrl?: string | null;
};

export type NormalizedInboundMessage = {
  channel: ExternalChannel;
  providerAccountId: string;
  externalEventId: string;
  externalConversationId: string;
  externalMessageId: string;
  senderName?: string | null;
  senderPhone?: string | null;
  body?: string | null;
  occurredAt: Date;
  attachments: ExternalMediaReference[];
};

function compactText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

function isDuplicate(error: unknown) {
  const causes: unknown[] = [error];
  if (error && typeof error === "object" && "cause" in error) causes.push((error as { cause?: unknown }).cause);
  return causes.some(candidate => {
    const code = candidate && typeof candidate === "object" && "code" in candidate ? String((candidate as { code?: unknown }).code) : "";
    const text = candidate instanceof Error ? candidate.message : String(candidate);
    return code === "ER_DUP_ENTRY" || text.includes("Duplicate") || text.includes("ER_DUP_ENTRY");
  });
}

/** Returns only safe connection state; provider tokens are never persisted or returned. */
export async function listChannelAccounts(storeId: number) {
  const db = await requireDb();
  return db.select().from(channelAccounts).where(eq(channelAccounts.storeId, storeId));
}

/** Creates or updates a non-secret channel identity. Live connection still requires environment secrets and Meta setup. */
export async function configureChannelAccount(input: {
  storeId: number;
  actorUserId: number;
  channel: ExternalChannel;
  providerAccountId?: string | null;
  providerDisplayName?: string | null;
  connectionStatus: "disconnected" | "testing" | "connected" | "disabled";
}) {
  const db = await requireDb();
  const providerAccountId = compactText(input.providerAccountId, 255) || null;
  const providerDisplayName = compactText(input.providerDisplayName, 160) || null;
  const [existing] = await db.select().from(channelAccounts).where(and(eq(channelAccounts.storeId, input.storeId), eq(channelAccounts.channel, input.channel))).limit(1);
  try {
    if (existing) {
      await db.update(channelAccounts).set({ providerAccountId, providerDisplayName, connectionStatus: input.connectionStatus, lastError: null }).where(eq(channelAccounts.id, existing.id));
      return { ...existing, providerAccountId, providerDisplayName, connectionStatus: input.connectionStatus, lastError: null };
    }
    const result = await db.insert(channelAccounts).values({ storeId: input.storeId, channel: input.channel, providerAccountId, providerDisplayName, connectionStatus: input.connectionStatus, createdByUserId: input.actorUserId });
    const [created] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, Number(result[0].insertId))).limit(1);
    if (!created) throw new Error("تعذر حفظ تعريف حساب القناة.");
    return created;
  } catch (error) {
    if (isDuplicate(error)) throw new Error("معرّف الحساب الخارجي مرتبط بالفعل بمتجر آخر لهذه القناة.");
    throw error;
  }
}

/** Records one signed incoming message. It never sends a message, calls an LLM, or follows arbitrary media URLs. */
export async function ingestExternalInboundMessage(input: NormalizedInboundMessage & { payloadHash: string; reservedWebhookEventId?: number }) {
  const db = await requireDb();
  const [account] = await db.select().from(channelAccounts).where(and(
    eq(channelAccounts.channel, input.channel),
    eq(channelAccounts.providerAccountId, input.providerAccountId),
  )).limit(1);
  if (!account || !["testing", "connected"].includes(account.connectionStatus)) {
    return { accepted: false as const, reason: "unlinked_account" as const, storeId: null };
  }

  try {
    return await db.transaction(async tx => {
      if (!input.reservedWebhookEventId) {
        try {
          await tx.insert(channelWebhookEvents).values({
          storeId: account.storeId,
          channelAccountId: account.id,
          externalEventId: input.externalEventId,
          payloadHash: input.payloadHash,
          eventType: "message",
          processingStatus: "received",
          });
        } catch (error) {
          if (isDuplicate(error)) return { accepted: true as const, duplicate: true as const, conversationId: null, messageId: null, mediaIds: [] as number[], storeId: account.storeId };
          throw error;
        }
      }

      const [conversation] = await tx.select().from(inboxConversations).where(and(
        eq(inboxConversations.storeId, account.storeId),
        eq(inboxConversations.channel, input.channel),
        eq(inboxConversations.externalConversationId, input.externalConversationId),
      )).limit(1);
      let conversationId = conversation?.id;
      if (!conversationId) {
        const created = await tx.insert(inboxConversations).values({
          storeId: account.storeId,
          channel: input.channel,
          externalConversationId: input.externalConversationId,
          contactNameSnapshot: compactText(input.senderName, 160) || null,
          contactPhoneSnapshot: compactText(input.senderPhone, 40) || null,
          subject: `رسائل ${input.channel === "whatsapp" ? "واتساب" : input.channel === "instagram" ? "إنستغرام" : "Messenger"}`,
          status: "open",
          lastMessageAt: input.occurredAt,
        });
        conversationId = Number(created[0].insertId);
        await tx.insert(inboxConversationEvents).values({ storeId: account.storeId, conversationId, type: "created", toValue: input.channel });
      }

      const messageBody = compactText(input.body, 20_000) || (input.attachments.length ? "أرسل العميل مرفقًا للاستفسار." : "رسالة واردة بلا نص.");
      let messageId: number;
      try {
        const createdMessage = await tx.insert(inboxMessages).values({
          conversationId,
          direction: "inbound",
          body: messageBody,
          externalMessageId: input.externalMessageId,
          occurredAt: input.occurredAt,
        });
        messageId = Number(createdMessage[0].insertId);
      } catch (error) {
        if (isDuplicate(error)) {
          await tx.update(channelWebhookEvents).set({ processingStatus: "ignored", processedAt: new Date(), errorSummary: "رسالة خارجية مكررة." }).where(input.reservedWebhookEventId ? eq(channelWebhookEvents.id, input.reservedWebhookEventId) : and(eq(channelWebhookEvents.channelAccountId, account.id), eq(channelWebhookEvents.externalEventId, input.externalEventId)));
          return { accepted: true as const, duplicate: true as const, conversationId, messageId: null, mediaIds: [] as number[], storeId: account.storeId };
        }
        throw error;
      }

      const mediaIds: number[] = [];
      for (let index = 0; index < input.attachments.length; index += 1) {
        const attachment = input.attachments[index];
        const media = await tx.insert(inboxMessageMedia).values({
          storeId: account.storeId,
          messageId,
          channelAccountId: account.id,
          providerMediaId: compactText(attachment.providerMediaId, 255) || `${input.externalMessageId}:${index + 1}`,
          mediaType: attachment.mediaType,
          mimeType: compactText(attachment.mimeType, 120) || null,
          originalFileName: compactText(attachment.originalFileName, 255) || null,
          downloadStatus: attachment.mediaType === "image" ? "pending" : "unsupported",
          errorSummary: attachment.mediaType === "image" ? null : "تحليل هذا النوع من المرفقات غير مفعّل في هذه الدفعة.",
        });
        mediaIds.push(Number(media[0].insertId));
      }

      await tx.update(inboxConversations).set({ status: "open", snoozedUntil: null, closedAt: null, lastMessageAt: input.occurredAt }).where(eq(inboxConversations.id, conversationId));
      await tx.insert(inboxConversationEvents).values({ storeId: account.storeId, conversationId, type: "message_recorded", toValue: "inbound" });
      await tx.update(channelAccounts).set({ lastInboundAt: input.occurredAt, lastError: null }).where(eq(channelAccounts.id, account.id));
      await tx.update(channelWebhookEvents).set({ processingStatus: "processed", processedAt: new Date() }).where(input.reservedWebhookEventId ? eq(channelWebhookEvents.id, input.reservedWebhookEventId) : and(eq(channelWebhookEvents.channelAccountId, account.id), eq(channelWebhookEvents.externalEventId, input.externalEventId)));
      return { accepted: true as const, duplicate: false as const, conversationId, messageId, mediaIds, storeId: account.storeId };
    });
  } catch (error) {
    const summary = error instanceof Error ? error.message.slice(0, 500) : "تعذر حفظ الرسالة الواردة.";
    await db.update(channelAccounts).set({ lastError: summary }).where(eq(channelAccounts.id, account.id));
    throw error;
  }
}

export async function applyExternalDeliveryStatus(input: { storeId: number; externalMessageId: string; status: "sent" | "delivered" | "read" | "failed"; occurredAt: Date; errorSummary?: string | null }) {
  const db = await requireDb();
  const rows = await db.select({ id: inboxMessages.id, current: inboxMessages.deliveryStatus }).from(inboxMessages).innerJoin(inboxConversations, eq(inboxMessages.conversationId, inboxConversations.id)).where(and(eq(inboxConversations.storeId, input.storeId), eq(inboxMessages.externalMessageId, input.externalMessageId)));
  if (!rows.length) return false;
  const rank = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 } as const;
  const ids = rows.filter(row => !row.current || rank[input.status] >= rank[row.current]).map(row => row.id);
  if (!ids.length) return true;
  await db.update(inboxMessages).set({
    deliveryStatus: input.status,
    deliveredAt: input.status === "delivered" || input.status === "read" ? input.occurredAt : undefined,
    readAt: input.status === "read" ? input.occurredAt : undefined,
    failedAt: input.status === "failed" ? input.occurredAt : undefined,
    statusError: input.status === "failed" ? input.errorSummary?.slice(0, 500) || "فشل التسليم لدى Meta." : null,
  }).where(inArray(inboxMessages.id, ids));
  return true;
}
