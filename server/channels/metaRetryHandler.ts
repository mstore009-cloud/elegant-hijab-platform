import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { metaWebhookRetrySettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { sdk } from "../_core/sdk";
import { processDueMetaHistorySyncJobs } from "../integrations/meta/historySync";
import { processDueWhatsAppHistoryChunks } from "../integrations/meta/whatsappHistoryWebhook";
import { retryDueMetaEvents } from "./metaEvents";

export async function handleScheduledMetaWebhookRetry(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "database-unavailable" });
    const [settings] = await db.select().from(metaWebhookRetrySettings).where(eq(metaWebhookRetrySettings.scheduleCronTaskUid, user.taskUid)).limit(1);
    if (!settings) return res.json({ ok: true, skipped: "orphan" });
    if (!settings.enabled) return res.json({ ok: true, skipped: "disabled" });
    const webhookRetry = await retryDueMetaEvents(30);
    const historySync = await processDueMetaHistorySyncJobs(3);
    const whatsappHistory = await processDueWhatsAppHistoryChunks(2);
    const result = { webhookRetry, historySync, whatsappHistory };
    await db.update(metaWebhookRetrySettings).set({ lastRunAt: new Date(), lastResult: JSON.stringify(result).slice(0, 500) }).where(eq(metaWebhookRetrySettings.id, settings.id));
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "meta-retry-failed", context: { url: req.originalUrl }, timestamp: new Date().toISOString() });
  }
}
