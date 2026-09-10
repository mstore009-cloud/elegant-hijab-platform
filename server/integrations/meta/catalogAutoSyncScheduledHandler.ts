import type { Request, Response } from "express";
import { sdk } from "../../_core/sdk";
import { getCatalogSyncSettingsByMetaAutoSyncTaskUid } from "../../products/catalogSyncSettings";
import { processMetaCatalogAutoSync } from "./catalogAutoSync";

/** Authenticated HTTP callback used only by the platform-managed Meta auto-sync task. */
export async function handleScheduledMetaCatalogAutoSync(req: Request, res: Response) {
  let taskUid: string | undefined;
  try {
    const caller = await sdk.authenticateRequest(req);
    if (!caller.isCron || !caller.taskUid) return res.status(403).json({ error: "cron-only" });
    taskUid = caller.taskUid;
    const setting = await getCatalogSyncSettingsByMetaAutoSyncTaskUid(taskUid);
    if (!setting || !setting.metaAutoSyncEnabled) return res.json({ ok: true, skipped: "orphan_or_disabled" });
    const summary = await processMetaCatalogAutoSync({ storeId: setting.storeId });
    return res.json({ ok: true, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر تنفيذ مزامنة Meta التلقائية.";
    return res.status(500).json({ error: message, context: { taskUid: taskUid ?? null }, timestamp: new Date().toISOString() });
  }
}
