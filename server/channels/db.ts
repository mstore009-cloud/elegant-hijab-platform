import { and, eq, inArray } from "drizzle-orm";
import {
  channelAccounts,
  channelWebhookEvents,
  inboxConversationEvents,
  inboxConversations,
  inboxMessageMedia,
  inboxMessages,
  customerProfiles,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { appendCustomerActivity, normalizeCustomerPhone } from "../crm/db";

export const externalChannels = ["whatsapp", "instagram", "messenger"] as const;
export type ExternalChannel = (typeof externalChannels)[number];

export type ExternalMediaReference = {
  providerMediaId?: string | null;
  mediaType: "image" | "video" | "audio" | "document" | "unsupported";
  mimeType?: string | null;
  originalFileName?: string | null;
  sourceUrl?: string | null;
};

export type NormalizedMessageMetadata = {
  messageType?: string | null;
  replyToExternalMessageId?: string | null;
  replyToBodyPreview?: string | null;
  storyId?: string | null;
  mentions?: Array<{ id: string; name?: string | null }>;
  unsupportedReason?: string | null;
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
  direction?: "inbound" | "outbound";
  source?: "live_webhook" | "historical_sync";
  externalThreadId?: string | null;
  nativeThreadUrl?: string | null;
  senderExternalId?: string | null;
  senderAvatarUrl?: string | null;
  senderUsername?: string | null;
  senderProfileMetadata?: Record<string, unknown> | null;
  metadata?: NormalizedMessageMetadata | null;
};

function compactMetadata(metadata?: NormalizedMessageMetadata | null) {
  if (!metadata) return null;
  const safe = {
    messageType: compactText(metadata.messageType, 40) || null,
    replyToExternalMessageId: compactText(metadata.replyToExternalMessageId, 255) || null,
    replyToBodyPreview: compactText(metadata.replyToBodyPreview, 300) || null,
    storyId: compactText(metadata.storyId, 255) || null,
    mentions: Array.isArray(metadata.mentions) ? metadata.mentions.slice(0, 20).map(mention => ({ id: compactText(mention.id, 255), name: compactText(mention.name, 160) || null })).filter(mention => mention.id) : [],
    unsupportedReason: compactText(metadata.unsupportedReason, 255) || null,
  } satisfies NormalizedMessageMetadata;
  return JSON.stringify(safe).slice(0, 8_000);
}

function compactText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function socialIdentityKey(channel: ExternalChannel, externalId: string) {
  let hash = 2166136261;
  for (const character of `${channel}:${externalId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `social:${channel}:${(hash >>> 0).toString(36)}`.slice(0, 40);
}

function nativeThreadFallback(input: Pick<NormalizedInboundMessage, "channel" | "providerAccountId" | "senderPhone" | "nativeThreadUrl" | "externalThreadId">) {
  if (input.nativeThreadUrl) return compactText(input.nativeThreadUrl, 2048);
  const threadId = compactText(input.externalThreadId, 255);
  if (input.channel === "messenger") return `https://www.facebook.com/messages/t/${encodeURIComponent(threadId || input.providerAccountId)}`;
  if (input.channel === "instagram") return threadId ? `https://www.instagram.com/direct/t/${encodeURIComponent(threadId)}` : "https://www.instagram.com/direct/inbox/";
  const digits = compactText(input.senderPhone, 40).replace(/[^0-9]/g, "");
  return digits ? `https://wa.me/${digits}` : "https://web.whatsapp.com/";
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
  const accountMatch = providerAccountId ? and(eq(channelAccounts.storeId, input.storeId), eq(channelAccounts.channel, input.channel), eq(channelAccounts.providerAccountId, providerAccountId)) : and(eq(channelAccounts.storeId, input.storeId), eq(channelAccounts.channel, input.channel));
  const [existing] = await db.select().from(channelAccounts).where(accountMatch).limit(1);
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

export async function updateChannelSubscriptionHealth(input: {
  storeId: number;
  channel: ExternalChannel;
  appSubscriptionStatus: "unknown" | "ready" | "error";
  assetSubscriptionStatus: "unknown" | "ready" | "error";
  error?: string | null;
  providerAccountId?: string | null;
}) {
  const db = await requireDb();
  const providerAccountId = compactText(input.providerAccountId, 255) || null;
  const accountMatch = providerAccountId ? and(eq(channelAccounts.storeId, input.storeId), eq(channelAccounts.channel, input.channel), eq(channelAccounts.providerAccountId, providerAccountId)) : and(eq(channelAccounts.storeId, input.storeId), eq(channelAccounts.channel, input.channel));
  const [account] = await db.select().from(channelAccounts).where(accountMatch).limit(1);
  if (!account) throw new Error("اختر حساب القناة أولاً قبل فحص الاشتراك.");
  const subscriptionLastCheckedAt = new Date();
  const lastError = input.error?.slice(0, 500) || null;
  await db.update(channelAccounts).set({ appSubscriptionStatus: input.appSubscriptionStatus, assetSubscriptionStatus: input.assetSubscriptionStatus, subscriptionLastCheckedAt, lastError }).where(and(eq(channelAccounts.id, account.id), eq(channelAccounts.storeId, input.storeId)));
  return { ...account, appSubscriptionStatus: input.appSubscriptionStatus, assetSubscriptionStatus: input.assetSubscriptionStatus, subscriptionLastCheckedAt, lastError };
}

/** Records one signed incoming message. It never sends a message, calls an LLM, or follows arbitrary media URLs. */
export async function ingestExternalInboundMessage(input: NormalizedInboundMessage & { payloadHash: string; reservedWebhookEventId?: number }) {
  const db = await requireDb();
  const messageSource = input.source ?? "live_webhook";
  const [account] = await db.select().from(channelAccounts).where(and(
    eq(channelAccounts.channel, input.channel),
    eq(channelAccounts.providerAccountId, input.providerAccountId),
  )).limit(1);
  if (!account || !["testing", "connected"].includes(account.connectionStatus)) {
    return { accepted: false as const, reason: "unlinked_account" as const, storeId: null };
  }

  try {
    return await db.transaction(async tx => {
      if (!input.reservedWebhookEventId && messageSource === "live_webhook") {
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
      let customerId = conversation?.customerId ?? null;
      const phoneDisplay = compactText(input.senderPhone, 40) || "";
      const phoneNormalized = phoneDisplay ? normalizeCustomerPhone(phoneDisplay) : "";
      const senderExternalId = compactText(input.senderExternalId, 255) || null;
      const profileImageUrl = compactText(input.senderAvatarUrl, 2048) || null;
      const socialUsername = compactText(input.senderUsername, 160) || null;
      const profileMetadataJson = input.senderProfileMetadata ? JSON.stringify(input.senderProfileMetadata).slice(0, 4000) : null;
      const socialPhone = senderExternalId ? socialIdentityKey(input.channel, senderExternalId) : "";
      if (!customerId && senderExternalId) {
        const [matchedSocialCustomer] = await tx.select().from(customerProfiles).where(and(eq(customerProfiles.storeId, account.storeId), eq(customerProfiles.externalProfileId, senderExternalId))).limit(1);
        if (matchedSocialCustomer) {
          customerId = matchedSocialCustomer.id;
          await tx.update(customerProfiles).set({ displayName: compactText(input.senderName, 160) || matchedSocialCustomer.displayName, profileImageUrl: profileImageUrl || matchedSocialCustomer.profileImageUrl, socialUsername: socialUsername || matchedSocialCustomer.socialUsername, profileMetadataJson: profileMetadataJson || matchedSocialCustomer.profileMetadataJson, updatedAt: new Date() }).where(and(eq(customerProfiles.id, matchedSocialCustomer.id), eq(customerProfiles.storeId, account.storeId)));
        }
      }
      if (!customerId && (phoneNormalized.length >= 7 && phoneNormalized.length <= 40 || socialPhone)) {
        const identityPhone = phoneNormalized.length >= 7 && phoneNormalized.length <= 40 ? phoneNormalized : socialPhone;
        const [matchedCustomer] = await tx.select().from(customerProfiles).where(and(eq(customerProfiles.storeId, account.storeId), eq(customerProfiles.phoneNormalized, identityPhone))).limit(1);
        if (matchedCustomer) {
          customerId = matchedCustomer.id;
          await tx.update(customerProfiles).set({ displayName: compactText(input.senderName, 160) || matchedCustomer.displayName, phoneDisplay, profileImageUrl: profileImageUrl || matchedCustomer.profileImageUrl, socialUsername: socialUsername || matchedCustomer.socialUsername, externalProfileId: senderExternalId || matchedCustomer.externalProfileId, profileMetadataJson: profileMetadataJson || matchedCustomer.profileMetadataJson, lastChannel: input.channel, updatedAt: new Date() }).where(and(eq(customerProfiles.id, matchedCustomer.id), eq(customerProfiles.storeId, account.storeId)));
        } else {
          const createdCustomer = await tx.insert(customerProfiles).values({ storeId: account.storeId, displayName: compactText(input.senderName, 160) || "عميل من المحادثات", phoneNormalized: identityPhone, phoneDisplay, profileImageUrl, socialUsername, externalProfileId: senderExternalId, profileMetadataJson, relationshipStage: "new", firstChannel: input.channel, lastChannel: input.channel });
          customerId = Number(createdCustomer[0].insertId);
          await appendCustomerActivity(tx, { storeId: account.storeId, customerId, type: "profile_created", title: "أُنشئ ملف العميل من رسالة واردة" });
        }
      }
      if (!conversationId) {
        const created = await tx.insert(inboxConversations).values({
          storeId: account.storeId,
          customerId,
          channelAccountId: account.id,
          channel: input.channel,
          externalConversationId: input.externalConversationId,
          externalThreadId: compactText(input.externalThreadId, 255) || null,
          nativeThreadUrl: nativeThreadFallback(input),
          contactNameSnapshot: compactText(input.senderName, 160) || null,
          contactPhoneSnapshot: phoneDisplay || null,
          contactAvatarUrl: profileImageUrl,
          contactUsername: socialUsername,
          contactProfileJson: profileMetadataJson,
          subject: `رسائل ${input.channel === "whatsapp" ? "واتساب" : input.channel === "instagram" ? "إنستغرام" : "Messenger"}`,
          status: "open",
          lastMessageAt: input.occurredAt,
        });
        conversationId = Number(created[0].insertId);
        await tx.insert(inboxConversationEvents).values({ storeId: account.storeId, conversationId, type: "created", toValue: input.channel });
      } else if (conversationId) {
        await tx.update(inboxConversations).set({ customerId: customerId ?? conversation?.customerId ?? null, externalThreadId: compactText(input.externalThreadId, 255) || conversation?.externalThreadId || null, nativeThreadUrl: nativeThreadFallback(input) || conversation?.nativeThreadUrl || null, contactNameSnapshot: compactText(input.senderName, 160) || conversation?.contactNameSnapshot || null, contactPhoneSnapshot: phoneDisplay || conversation?.contactPhoneSnapshot || null, contactAvatarUrl: profileImageUrl || conversation?.contactAvatarUrl || null, contactUsername: socialUsername || conversation?.contactUsername || null, contactProfileJson: profileMetadataJson || conversation?.contactProfileJson || null }).where(and(eq(inboxConversations.id, conversationId), eq(inboxConversations.storeId, account.storeId)));
        if (customerId && !conversation?.customerId) await tx.insert(inboxConversationEvents).values({ storeId: account.storeId, conversationId, type: "customer_linked", toValue: String(customerId) });
      }

      const direction = input.direction ?? "inbound";
      const source = messageSource;
      // A media-only message should render as its media, not as a technical sentence
      // above the asset. Keep a non-null empty body for the append-only schema.
      const messageBody = compactText(input.body, 20_000) || (input.attachments.length ? "" : (direction === "inbound" ? "رسالة واردة بلا نص." : "رسالة صادرة بلا نص."));
      let messageId: number;
      try {
        const createdMessage = await tx.insert(inboxMessages).values({
          conversationId,
          direction,
          body: messageBody,
          metadataJson: compactMetadata(input.metadata),
          externalMessageId: input.externalMessageId,
          source,
          occurredAt: input.occurredAt,
        });
        messageId = Number(createdMessage[0].insertId);
      } catch (error) {
        if (isDuplicate(error)) {
          if (source === "live_webhook") await tx.update(channelWebhookEvents).set({ processingStatus: "ignored", processedAt: new Date(), errorSummary: "رسالة خارجية مكررة." }).where(input.reservedWebhookEventId ? eq(channelWebhookEvents.id, input.reservedWebhookEventId) : and(eq(channelWebhookEvents.channelAccountId, account.id), eq(channelWebhookEvents.externalEventId, input.externalEventId)));
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
          downloadStatus: ["image", "video", "audio", "document"].includes(attachment.mediaType) ? "pending" : "unsupported",
          errorSummary: ["image", "video", "audio", "document"].includes(attachment.mediaType) ? null : "هذا النوع من المرفقات غير مدعوم للمعاينة حالياً.",
        });
        mediaIds.push(Number(media[0].insertId));
      }

      const lastMessageAt = !conversation?.lastMessageAt || input.occurredAt > conversation.lastMessageAt ? input.occurredAt : conversation.lastMessageAt;
      await tx.update(inboxConversations).set(source === "historical_sync" ? { lastMessageAt } : { status: "open", snoozedUntil: null, closedAt: null, lastMessageAt }).where(eq(inboxConversations.id, conversationId));
      await tx.insert(inboxConversationEvents).values({ storeId: account.storeId, conversationId, type: "message_recorded", toValue: source === "historical_sync" ? `historical:${direction}` : direction });
      if (source === "live_webhook" && direction === "inbound") await tx.update(channelAccounts).set({ lastInboundAt: input.occurredAt, lastError: null }).where(eq(channelAccounts.id, account.id));
      if (customerId && direction === "inbound" && source === "live_webhook") await appendCustomerActivity(tx, { storeId: account.storeId, customerId, type: "inbox_message", title: `رسالة واردة عبر ${input.channel}`, body: messageBody });
      if (source === "live_webhook") await tx.update(channelWebhookEvents).set({ processingStatus: "processed", processedAt: new Date() }).where(input.reservedWebhookEventId ? eq(channelWebhookEvents.id, input.reservedWebhookEventId) : and(eq(channelWebhookEvents.channelAccountId, account.id), eq(channelWebhookEvents.externalEventId, input.externalEventId)));
      return { accepted: true as const, duplicate: false as const, conversationId, messageId, mediaIds, storeId: account.storeId, customerId };
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
