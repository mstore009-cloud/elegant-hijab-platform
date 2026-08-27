import type { Request, Response } from "express";
import { sdk } from "../_core/sdk";
import { scanCatalogForOwner } from "./catalogAutomation";
import { getCatalogSyncSettingsByTaskUid, markCatalogSyncCompleted, markCatalogSyncFailed, markCatalogSyncStarted } from "./catalogSyncSettings";

/** Authenticated HTTP callback used only by the platform-managed periodic task. */
export async function handleScheduledCatalogScan(req: Request, res: Response) {
  let taskUid: string | undefined;
  try {
    const caller = await sdk.authenticateRequest(req);
    if (!caller.isCron || !caller.taskUid) return res.status(403).json({ error: "cron-only" });
    taskUid = caller.taskUid;
    const setting = await getCatalogSyncSettingsByTaskUid(taskUid);
    if (!setting || !setting.isEnabled) return res.json({ ok: true, skipped: "orphan_or_disabled" });
    await markCatalogSyncStarted(setting.id);
    const summary = await scanCatalogForOwner({ ownerUserId: setting.ownerUserId, storeId: setting.storeId });
    await markCatalogSyncCompleted({ settingId: setting.id, summary });
    return res.json({ ok: true, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر تنفيذ فحص Catalog الدوري.";
    if (taskUid) {
      const setting = await getCatalogSyncSettingsByTaskUid(taskUid).catch(() => null);
      if (setting) await markCatalogSyncFailed({ settingId: setting.id, error: message }).catch(() => undefined);
    }
    return res.status(500).json({ error: message, context: { taskUid: taskUid ?? null }, timestamp: new Date().toISOString() });
  }
}
