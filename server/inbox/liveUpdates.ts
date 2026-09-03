import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { channelWebhookEvents } from "../../drizzle/schema";
import { sdk } from "../_core/sdk";
import { getDb } from "../db";
import { getOperationalStoreContext } from "../stores/db";
import { assertPermission } from "../access/authorization";

const LIVE_CHECK_INTERVAL_MS = 500;
const LIVE_HEARTBEAT_INTERVAL_MS = 15_000;

function parseCursor(value: unknown) {
  if (value === "latest" || value === undefined) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
}

function writeFrame(res: Response, event: string, data: Record<string, number>) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function openInboxLiveUpdates(req: Request, res: Response) {
  let user;
  let store;
  try {
    user = await sdk.authenticateRequest(req);
    const context = await getOperationalStoreContext(user);
    store = context?.store ?? null;
    if (!store) return res.status(403).json({ error: "لا يوجد متجر تشغيلي مخصص للحساب الحالي." });
    await assertPermission(user, "inbox.read", store.id);
  } catch {
    return res.status(401).json({ error: "غير مصرح بفتح تحديثات Inbox الحية." });
  }

  const db = await getDb();
  if (!db) return res.status(503).json({ error: "قاعدة البيانات غير متاحة حالياً." });

  let cursor = parseCursor(req.query.after);
  if (cursor === null) {
    const [latest] = await db.select({ id: channelWebhookEvents.id }).from(channelWebhookEvents).where(and(
      eq(channelWebhookEvents.storeId, store.id),
      eq(channelWebhookEvents.eventType, "message"),
      eq(channelWebhookEvents.processingStatus, "processed"),
    )).orderBy(desc(channelWebhookEvents.id)).limit(1);
    cursor = latest?.id ?? 0;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(": inbox-live-ready\n\n");

  let closed = false;
  let checking = false;
  const checkForInboxMessages = async () => {
    if (closed || checking) return;
    checking = true;
    try {
      const rows = await db.select({ id: channelWebhookEvents.id }).from(channelWebhookEvents).where(and(
        eq(channelWebhookEvents.storeId, store.id),
        eq(channelWebhookEvents.eventType, "message"),
        eq(channelWebhookEvents.processingStatus, "processed"),
        gt(channelWebhookEvents.id, cursor!),
      )).orderBy(asc(channelWebhookEvents.id)).limit(25);
      for (const row of rows) {
        cursor = row.id;
        // Event identifiers only: bodies, customers, assets, and tokens never leave this stream.
        writeFrame(res, "inbox_message", { id: row.id });
      }
    } catch (error) {
      console.error("[InboxLive] تعذر فحص رسائل Inbox الحية:", error);
    } finally {
      checking = false;
    }
  };

  const checkTimer = setInterval(() => { void checkForInboxMessages(); }, LIVE_CHECK_INTERVAL_MS);
  const heartbeatTimer = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": heartbeat\n\n");
  }, LIVE_HEARTBEAT_INTERVAL_MS);
  req.on("close", () => {
    closed = true;
    clearInterval(checkTimer);
    clearInterval(heartbeatTimer);
  });
}

export function registerInboxLiveUpdateRoute(app: Express) {
  app.get("/api/inbox/live", (req, res) => { void openInboxLiveUpdates(req, res); });
}
