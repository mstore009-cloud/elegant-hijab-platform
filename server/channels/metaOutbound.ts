import { and, desc, eq } from "drizzle-orm";
import { channelAccounts, inboxConversationEvents, inboxConversations, inboxMessages, metaAssets, metaConnections, metaOutboundMessages } from "../../drizzle/schema";
import { getDb } from "../db";
import { getMetaRuntimeSettings } from "../integrations/meta/platformSettings";
import { getMetaSystemUserToken } from "../integrations/meta/db";
import { loadWhatsAppBusinessToken } from "../integrations/meta/whatsappCoexistence";
import { decryptMetaToken, metaAssetTokenContext, metaConnectionTokenContext } from "../integrations/meta/tokenCipher";

type SupportedChannel = "whatsapp" | "instagram" | "messenger";
type SendMode = "manual" | "bot_guarded" | "comment_guarded";
export type MetaSendTransport = (input: { channel: SupportedChannel; providerAccountId: string; recipientExternalId: string; body: string; accessToken: string }) => Promise<{ externalMessageId: string }>;

function duplicateError(error: unknown): boolean {
  if (!error) return false;
  const anyError = error as any;
  return anyError?.code === "ER_DUP_ENTRY" || anyError?.errno === 1062 || String(anyError?.message ?? "").includes("Duplicate entry") || duplicateError(anyError?.cause);
}

async function defaultTransport(input: Parameters<MetaSendTransport>[0]) {
  const runtime = await getMetaRuntimeSettings();
  const endpoint = `https://graph.facebook.com/${runtime.graphApiVersion}/${input.providerAccountId}/messages`;
  const payload = input.channel === "whatsapp"
    ? { messaging_product: "whatsapp", to: input.recipientExternalId, type: "text", text: { preview_url: false, body: input.body } }
    : { recipient: { id: input.recipientExternalId }, messaging_type: input.channel === "messenger" ? "RESPONSE" : undefined, message: { text: input.body } };
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const json = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw Object.assign(new Error(json?.error?.message || `رفضت Meta الإرسال (${response.status}).`), { code: json?.error?.code ? String(json.error.code) : `HTTP_${response.status}` });
  const externalMessageId = input.channel === "whatsapp" ? json?.messages?.[0]?.id : json?.message_id;
  if (!externalMessageId) throw new Error("قبلت Meta الطلب دون إعادة معرف رسالة.");
  return { externalMessageId: String(externalMessageId) };
}

export async function loadMetaCredential(storeId: number, channelAccount: typeof channelAccounts.$inferSelect) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة.");
  const [unifiedConnection] = await db.select({ id: metaConnections.id, status: metaConnections.status }).from(metaConnections).where(and(eq(metaConnections.storeId, storeId), eq(metaConnections.purpose, "unified"))).limit(1);
  const candidates = await db.select({ assetId: metaAssets.id, assetExternalId: metaAssets.externalId, assetType: metaAssets.assetType, parentExternalId: metaAssets.parentExternalId, encryptedAssetToken: metaAssets.encryptedAccessToken, connectionId: metaConnections.id, connectionPurpose: metaConnections.purpose, connectionStatus: metaConnections.status, encryptedConnectionToken: metaConnections.encryptedAccessToken }).from(metaAssets).innerJoin(metaConnections, eq(metaAssets.connectionId, metaConnections.id)).where(and(eq(metaAssets.storeId, storeId), eq(metaAssets.externalId, channelAccount.providerAccountId!), eq(metaConnections.storeId, storeId), eq(metaAssets.isSelected, true)));
  if (unifiedConnection && unifiedConnection.status !== "connected") throw new Error("اتصال Meta الموحد غير صالح حالياً. أعد الربط قبل الإرسال.");
  const asset = unifiedConnection ? candidates.find(candidate => candidate.connectionPurpose === "unified") : candidates.find(candidate => candidate.connectionPurpose === "messaging");
  if (!asset || asset.connectionStatus === "revoked") throw new Error("أصل Meta المحدد لهذه القناة غير مفوض حالياً.");
  if (channelAccount.channel === "whatsapp") {
    const embedded = await loadWhatsAppBusinessToken(storeId, channelAccount.providerAccountId);
    if (embedded) return { accessToken: embedded.accessToken, providerAccountId: embedded.onboarding.phoneNumberId };
    const systemUserToken = await getMetaSystemUserToken(storeId);
    if (systemUserToken) return { accessToken: systemUserToken, providerAccountId: asset.assetExternalId };
  }
  let encryptedToken = asset.encryptedAssetToken;
  let tokenContext = metaAssetTokenContext(storeId, asset.assetExternalId);
  if (!encryptedToken && asset.assetType === "instagram" && asset.parentExternalId) {
    const [parent] = await db.select().from(metaAssets).where(and(eq(metaAssets.storeId, storeId), eq(metaAssets.connectionId, asset.connectionId), eq(metaAssets.externalId, asset.parentExternalId))).limit(1);
    if (parent?.encryptedAccessToken) { encryptedToken = parent.encryptedAccessToken; tokenContext = metaAssetTokenContext(storeId, parent.externalId); }
  }
  if (!encryptedToken && asset.encryptedConnectionToken) { encryptedToken = asset.encryptedConnectionToken; tokenContext = metaConnectionTokenContext(storeId, asset.connectionPurpose); }
  if (!encryptedToken) throw new Error("لا يوجد رمز وصول صالح للأصل المحدد. أعد تفويض نطاق الرسائل.");
  return { accessToken: decryptMetaToken(encryptedToken, tokenContext), providerAccountId: asset.assetType === "instagram" && asset.parentExternalId ? asset.parentExternalId : asset.assetExternalId };
}

export async function sendMetaConversationMessage(input: { storeId: number; conversationId: number; body: string; idempotencyKey: string; mode: SendMode; actorUserId?: number | null; botRunId?: number | null }, transport: MetaSendTransport = defaultTransport) {
  const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة.");
  const body = input.body.trim(); if (!body || body.length > 4000) throw new Error("نص الرسالة مطلوب وبحد أقصى 4000 حرف.");
  const [conversation] = await db.select().from(inboxConversations).where(and(eq(inboxConversations.id, input.conversationId), eq(inboxConversations.storeId, input.storeId))).limit(1);
  if (!conversation) throw new Error("المحادثة لا تنتمي إلى المتجر الحالي.");
  if (!(["whatsapp", "instagram", "messenger"] as string[]).includes(conversation.channel) || !conversation.externalConversationId) throw new Error("هذه المحادثة ليست مرتبطة بقناة Meta قابلة للإرسال.");
  const channel = conversation.channel as SupportedChannel;
  const bodyBytes = Buffer.byteLength(body, "utf8");
  if (channel === "instagram" && bodyBytes > 1000) throw new Error("رسالة Instagram تتجاوز حد 1000 بايت المسموح به.");
  if (channel === "messenger" && bodyBytes > 2000) throw new Error("رسالة Messenger تتجاوز الحد الآمن المعتمد 2000 بايت.");
  const [latestInbound] = await db.select({ occurredAt: inboxMessages.occurredAt }).from(inboxMessages).where(and(eq(inboxMessages.conversationId, conversation.id), eq(inboxMessages.direction, "inbound"))).orderBy(desc(inboxMessages.occurredAt), desc(inboxMessages.id)).limit(1);
  if (!latestInbound || latestInbound.occurredAt.getTime() < Date.now() - 24 * 60 * 60 * 1000) throw new Error("انتهت نافذة المحادثة الحرة البالغة 24 ساعة. يلزم قالب أو مسار معتمد منفصل ولا يمكن الإرسال الحر من هنا.");
  const [account] = await db.select().from(channelAccounts).where(and(eq(channelAccounts.storeId, input.storeId), eq(channelAccounts.channel, channel))).limit(1);
  if (!account || !["testing", "connected"].includes(account.connectionStatus)) throw new Error("القناة غير جاهزة للإرسال اليدوي. اختبر الاتصال وحدد الأصل أولاً.");
  const recipientExternalId = conversation.externalConversationId.replace(new RegExp(`^${channel}:`), "");
  if (!recipientExternalId || recipientExternalId === conversation.externalConversationId) throw new Error("معرف مستلم القناة غير صالح.");

  const existing = await db.select().from(metaOutboundMessages).where(and(eq(metaOutboundMessages.storeId, input.storeId), eq(metaOutboundMessages.idempotencyKey, input.idempotencyKey))).limit(1);
  if (existing[0]) return { outboxId: existing[0].id, status: existing[0].status, externalMessageId: existing[0].externalMessageId, duplicate: true as const, inboxMessageId: existing[0].inboxMessageId };
  let outboxId: number;
  try {
    const created = await db.insert(metaOutboundMessages).values({ storeId: input.storeId, channelAccountId: account.id, conversationId: conversation.id, channel, recipientExternalId, idempotencyKey: input.idempotencyKey, mode: input.mode, body, actorUserId: input.actorUserId ?? null, botRunId: input.botRunId ?? null });
    outboxId = Number(created[0].insertId);
  } catch (error) {
    if (!duplicateError(error)) throw error;
    const [duplicate] = await db.select().from(metaOutboundMessages).where(and(eq(metaOutboundMessages.storeId, input.storeId), eq(metaOutboundMessages.idempotencyKey, input.idempotencyKey))).limit(1);
    if (!duplicate) throw error;
    return { outboxId: duplicate.id, status: duplicate.status, externalMessageId: duplicate.externalMessageId, duplicate: true as const, inboxMessageId: duplicate.inboxMessageId };
  }

  await db.update(metaOutboundMessages).set({ status: "sending", errorCode: null, errorSummary: null }).where(eq(metaOutboundMessages.id, outboxId));
  try {
    const credential = await loadMetaCredential(input.storeId, account);
    const delivered = await transport({ channel, providerAccountId: credential.providerAccountId, recipientExternalId, body, accessToken: credential.accessToken });
    const messageId = await db.transaction(async tx => {
      const createdMessage = await tx.insert(inboxMessages).values({ conversationId: conversation.id, direction: "outbound", body, externalMessageId: delivered.externalMessageId, source: "outbound", actorUserId: input.actorUserId ?? null, deliveryStatus: "sent", deliveredAt: null });
      const inboxMessageId = Number(createdMessage[0].insertId);
      await tx.update(metaOutboundMessages).set({ status: "sent", externalMessageId: delivered.externalMessageId, inboxMessageId, sentAt: new Date() }).where(eq(metaOutboundMessages.id, outboxId));
      await tx.update(channelAccounts).set({ lastError: null }).where(eq(channelAccounts.id, account.id));
      await tx.update(inboxConversations).set({ lastMessageAt: new Date(), status: "waiting_customer" }).where(eq(inboxConversations.id, conversation.id));
      await tx.insert(inboxConversationEvents).values({ storeId: input.storeId, conversationId: conversation.id, type: "message_recorded", actorUserId: input.actorUserId ?? null, toValue: input.mode === "manual" ? "meta_manual_sent" : input.mode });
      return inboxMessageId;
    });
    return { outboxId, status: "sent" as const, externalMessageId: delivered.externalMessageId, duplicate: false as const, inboxMessageId: messageId };
  } catch (error) {
    const code = String((error as any)?.code ?? "SEND_FAILED").slice(0, 120);
    const summary = (error instanceof Error ? error.message : "تعذر إرسال رسالة Meta.").slice(0, 500);
    await db.update(metaOutboundMessages).set({ status: "failed", errorCode: code, errorSummary: summary }).where(eq(metaOutboundMessages.id, outboxId));
    await db.update(channelAccounts).set({ lastError: summary }).where(eq(channelAccounts.id, account.id));
    throw new Error(summary);
  }
}
