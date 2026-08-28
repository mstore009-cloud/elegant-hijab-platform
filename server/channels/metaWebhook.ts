import crypto from "crypto";
import express, { type Express, type Request, type Response } from "express";
import { ENV } from "../_core/env";
import { ingestExternalInboundMessage, type ExternalMediaReference, type NormalizedInboundMessage } from "./db";
import { storeInboundImageFromProvider } from "./media";

function text(value: unknown, max = 255) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function timestampFromUnix(value: unknown) {
  const seconds = Number(value);
  const date = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

export function isValidMetaSignature(rawBody: Buffer, signature: string | undefined, appSecret: string) {
  if (!appSecret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return constantTimeEqual(expected, signature);
}

export function isValidMetaChallenge(input: { mode?: unknown; challenge?: unknown; verifyToken?: unknown }, expectedVerifyToken: string) {
  return Boolean(expectedVerifyToken && input.mode === "subscribe" && typeof input.challenge === "string" && typeof input.verifyToken === "string" && constantTimeEqual(input.verifyToken, expectedVerifyToken));
}

function whatsappAttachments(message: Record<string, any>): ExternalMediaReference[] {
  if (message.type !== "image" || !message.image) return [];
  return [{ providerMediaId: text(message.image.id), mediaType: "image", mimeType: text(message.image.mime_type, 120) || "image/jpeg", originalFileName: null }];
}

function instagramAttachments(message: Record<string, any>): ExternalMediaReference[] {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  return attachments.map((attachment: any, index: number) => {
    const attachmentType = text(attachment?.type, 32);
    const url = text(attachment?.payload?.url, 2000);
    return {
      providerMediaId: text(attachment?.payload?.id) || null,
      mediaType: attachmentType === "image" && url ? "image" : "unsupported",
      mimeType: attachmentType === "image" ? "image/jpeg" : null,
      originalFileName: null,
      sourceUrl: url || null,
    } as ExternalMediaReference & { sourceUrl?: string | null };
  }).filter((attachment: ExternalMediaReference) => attachment.mediaType === "image" || attachment.mediaType === "unsupported");
}

/** Converts only customer-originated text/image events into the internal Inbox format. */
export function normalizeMetaWebhook(payload: any): NormalizedInboundMessage[] {
  const normalized: NormalizedInboundMessage[] = [];
  if (payload?.object === "whatsapp_business_account") {
    for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const value = change?.value;
        const accountId = text(value?.metadata?.phone_number_id);
        const contacts = new Map<string, string>((Array.isArray(value?.contacts) ? value.contacts : []).map((contact: any): [string, string] => [text(contact?.wa_id), text(contact?.profile?.name, 160)]));
        for (const message of Array.isArray(value?.messages) ? value.messages : []) {
          const messageId = text(message?.id);
          const sender = text(message?.from);
          if (!accountId || !messageId || !sender) continue;
          normalized.push({
            channel: "whatsapp",
            providerAccountId: accountId,
            externalEventId: messageId,
            externalConversationId: `whatsapp:${sender}`,
            externalMessageId: messageId,
            senderName: contacts.get(sender) || null,
            senderPhone: sender,
            body: text(message?.text?.body, 20_000) || text(message?.image?.caption, 20_000) || null,
            occurredAt: timestampFromUnix(message?.timestamp),
            attachments: whatsappAttachments(message),
          });
        }
      }
    }
  }
  if (payload?.object === "instagram") {
    for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
      const accountId = text(entry?.id);
      for (const envelope of Array.isArray(entry?.messaging) ? entry.messaging : []) {
        const message = envelope?.message;
        const messageId = text(message?.mid);
        const sender = text(envelope?.sender?.id);
        if (!accountId || !messageId || !sender || message?.is_echo) continue;
        normalized.push({
          channel: "instagram",
          providerAccountId: accountId,
          externalEventId: messageId,
          externalConversationId: `instagram:${sender}`,
          externalMessageId: messageId,
          senderName: null,
          senderPhone: null,
          body: text(message?.text, 20_000) || null,
          occurredAt: timestampFromUnix(envelope?.timestamp ? Number(envelope.timestamp) / 1000 : undefined),
          attachments: instagramAttachments(message ?? {}),
        });
      }
    }
  }
  return normalized;
}

async function receiveMetaWebhook(req: Request, res: Response) {
  if (!ENV.metaAppSecret) return res.status(503).json({ error: "قناة Meta غير مهيأة بعد." });
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const signature = typeof req.headers["x-hub-signature-256"] === "string" ? req.headers["x-hub-signature-256"] : undefined;
  if (!isValidMetaSignature(rawBody, signature, ENV.metaAppSecret)) return res.status(401).json({ error: "توقيع webhook غير صالح." });
  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "حمولة webhook ليست JSON صالحاً." });
  }
  const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  try {
    const results = [];
    for (const message of normalizeMetaWebhook(payload)) {
      const ingested = await ingestExternalInboundMessage({ ...message, payloadHash });
      if (ingested.accepted && !ingested.duplicate && ingested.conversationId && ingested.storeId) {
        for (let index = 0; index < message.attachments.length; index += 1) {
          const mediaId = ingested.mediaIds[index];
          const image = message.attachments[index] as ExternalMediaReference & { sourceUrl?: string | null };
          if (!mediaId || image.mediaType !== "image") continue;
          const stored = await storeInboundImageFromProvider({ storeId: ingested.storeId, mediaId, sourceUrl: image.sourceUrl });
          void stored;
        }
      }
      results.push(ingested);
    }
    return res.status(200).json({ received: results.length });
  } catch (error) {
    console.error("[MetaWebhook] تعذر حفظ webhook:", error);
    return res.status(500).json({ error: "تعذر حفظ الرسالة الواردة." });
  }
}

export function registerMetaWebhookRoutes(app: Express) {
  app.get("/api/webhooks/meta", (req, res) => {
    const query = req.query as Record<string, unknown>;
    if (!isValidMetaChallenge({ mode: query["hub.mode"], challenge: query["hub.challenge"], verifyToken: query["hub.verify_token"] }, ENV.metaWebhookVerifyToken)) {
      return res.status(403).send("Forbidden");
    }
    return res.status(200).type("text/plain").send(String(query["hub.challenge"]));
  });
  app.post("/api/webhooks/meta", express.raw({ type: "application/json", limit: "3mb" }), receiveMetaWebhook);
}
