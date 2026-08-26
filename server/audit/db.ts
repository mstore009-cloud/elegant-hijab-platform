import { desc, eq } from "drizzle-orm";
import { auditEvents } from "../../drizzle/schema";
import { getDb } from "../db";

export type AuditInput = {
  storeId: number;
  actorUserId?: number | null;
  entityType: string;
  entityId: string | number;
  action: string;
  summary: string;
  metadata?: Record<string, unknown> | null;
};

export async function recordAuditEvent(input: AuditInput) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");

  const result = await db.insert(auditEvents).values({
    storeId: input.storeId,
    actorUserId: input.actorUserId ?? null,
    entityType: input.entityType,
    entityId: String(input.entityId),
    action: input.action,
    summary: input.summary,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
  });

  return Number(result[0].insertId);
}

export async function listRecentAuditEvents(storeId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(auditEvents).where(eq(auditEvents.storeId, storeId)).orderBy(desc(auditEvents.createdAt), desc(auditEvents.id)).limit(limit);
}
