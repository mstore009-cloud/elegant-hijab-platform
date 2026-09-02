import crypto from "crypto";
import express, { type Express, type Request, type Response } from "express";
import { getMetaRuntimeSettings } from "../integrations/meta/platformSettings";
import { enqueueWhatsAppCoexistencePayload } from "../integrations/meta/whatsappHistoryWebhook";
import { enqueueAndProcessMetaEvent, normalizeMetaEvents } from "./metaEvents";
import type { NormalizedInboundMessage } from "./db";

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

/** Converts only customer-originated text/image events into the internal Inbox format. */
export function normalizeMetaWebhook(payload: any): NormalizedInboundMessage[] {
  return normalizeMetaEvents(payload).filter((event): event is { kind: "message" } & NormalizedInboundMessage => event.kind === "message").map(({ kind: _kind, ...message }) => message);
}

async function receiveMetaWebhook(req: Request, res: Response) {
  const runtime = await getMetaRuntimeSettings();
  if (!runtime.appSecret) return res.status(503).json({ error: "قناة Meta غير مهيأة بعد." });
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const signature = typeof req.headers["x-hub-signature-256"] === "string" ? req.headers["x-hub-signature-256"] : undefined;
  if (!isValidMetaSignature(rawBody, signature, runtime.appSecret)) return res.status(401).json({ error: "توقيع webhook غير صالح." });
  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "حمولة webhook ليست JSON صالحاً." });
  }
  const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  try {
    const coexistence = await enqueueWhatsAppCoexistencePayload(payload);
    const results = [];
    for (const event of normalizeMetaEvents(payload)) {
      results.push(await enqueueAndProcessMetaEvent(event, payloadHash));
    }
    return res.status(200).json({ received: results.length + coexistence.handled, accepted: results.filter(result => result.accepted).length + coexistence.queued, coexistence });
  } catch (error) {
    console.error("[MetaWebhook] تعذر حفظ webhook:", error);
    return res.status(500).json({ error: "تعذر حفظ الرسالة الواردة." });
  }
}

export function registerMetaWebhookRoutes(app: Express) {
  app.get("/api/webhooks/meta", async (req, res) => {
    const runtime = await getMetaRuntimeSettings();
    const query = req.query as Record<string, unknown>;
    if (!isValidMetaChallenge({ mode: query["hub.mode"], challenge: query["hub.challenge"], verifyToken: query["hub.verify_token"] }, runtime.webhookVerifyToken)) {
      return res.status(403).send("Forbidden");
    }
    return res.status(200).type("text/plain").send(String(query["hub.challenge"]));
  });
  app.post("/api/webhooks/meta", express.raw({ type: "application/json", limit: "3mb" }), receiveMetaWebhook);
}
