import { and, eq } from "drizzle-orm";
import { metaWhatsAppOnboardings } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { decryptMetaToken, encryptMetaToken, metaWhatsAppBusinessTokenContext } from "./tokenCipher";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

function compact(value: unknown, max = 255) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isDuplicate(error: unknown) {
  return String((error as any)?.code || "") === "ER_DUP_ENTRY" || String((error as any)?.message || error).includes("Duplicate");
}

export async function upsertWhatsAppOnboarding(input: {
  storeId: number;
  connectionId: number;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string | null;
  accessToken: string;
  tokenExpiresAt?: Date | null;
  coexistenceMode: "unknown" | "standard_cloud_api" | "coexistence";
  actorUserId: number;
}) {
  const db = await requireDb();
  const wabaId = compact(input.wabaId);
  const phoneNumberId = compact(input.phoneNumberId);
  if (!wabaId || !phoneNumberId || !input.accessToken) throw new Error("بيانات WhatsApp Embedded Signup غير مكتملة.");
  const now = new Date();
  const values = {
    storeId: input.storeId,
    connectionId: input.connectionId,
    wabaId,
    phoneNumberId,
    displayPhoneNumber: compact(input.displayPhoneNumber, 64) || null,
    encryptedBusinessToken: encryptMetaToken(input.accessToken, metaWhatsAppBusinessTokenContext(input.storeId, phoneNumberId)),
    tokenExpiresAt: input.tokenExpiresAt ?? null,
    onboardingStatus: "connected" as const,
    coexistenceMode: input.coexistenceMode,
    historyRequestId: null,
    contactsRequestId: null,
    historyProgress: 0,
    historyPhase: null,
    lastChunkOrder: null,
    onboardingCompletedAt: now,
    historySyncDeadlineAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    lastHistoryWebhookAt: null,
    completedAt: null,
    lastError: null,
    createdByUserId: input.actorUserId,
  };
  try {
    await db.insert(metaWhatsAppOnboardings).values(values).onDuplicateKeyUpdate({ set: values });
  } catch (error) {
    if (isDuplicate(error)) throw new Error("رقم WhatsApp هذا مرتبط بالفعل بمتجر آخر في المنصة.");
    throw error;
  }
  const [row] = await db.select().from(metaWhatsAppOnboardings).where(and(eq(metaWhatsAppOnboardings.storeId, input.storeId), eq(metaWhatsAppOnboardings.phoneNumberId, phoneNumberId))).limit(1);
  if (!row) throw new Error("تعذر حفظ نتيجة WhatsApp Embedded Signup.");
  return row;
}

export async function listWhatsAppOnboardings(storeId: number) {
  const db = await requireDb();
  const rows = await db.select().from(metaWhatsAppOnboardings).where(eq(metaWhatsAppOnboardings.storeId, storeId));
  return rows.map(({ encryptedBusinessToken: _secret, ...row }) => ({ ...row, hasBusinessToken: true }));
}

export async function getWhatsAppOnboardingByPhone(phoneNumberId: string) {
  const db = await requireDb();
  const [row] = await db.select().from(metaWhatsAppOnboardings).where(eq(metaWhatsAppOnboardings.phoneNumberId, compact(phoneNumberId))).limit(1);
  return row ?? null;
}

export async function getWhatsAppOnboardingByWaba(wabaId: string) {
  const db = await requireDb();
  const [row] = await db.select().from(metaWhatsAppOnboardings).where(eq(metaWhatsAppOnboardings.wabaId, compact(wabaId))).limit(1);
  return row ?? null;
}

export async function loadWhatsAppBusinessToken(storeId: number, phoneNumberId?: string | null) {
  const db = await requireDb();
  const filters = [eq(metaWhatsAppOnboardings.storeId, storeId)];
  if (phoneNumberId) filters.push(eq(metaWhatsAppOnboardings.phoneNumberId, compact(phoneNumberId)));
  const [row] = await db.select().from(metaWhatsAppOnboardings).where(and(...filters)).limit(1);
  if (!row || ["offboarded", "failed"].includes(row.onboardingStatus)) return null;
  return {
    onboarding: row,
    accessToken: decryptMetaToken(row.encryptedBusinessToken, metaWhatsAppBusinessTokenContext(storeId, row.phoneNumberId)),
  };
}

export async function markWhatsAppSyncRequested(input: { onboardingId: number; contactsRequestId?: string | null; historyRequestId?: string | null }) {
  const db = await requireDb();
  await db.update(metaWhatsAppOnboardings).set({
    onboardingStatus: input.historyRequestId ? "history_requested" : undefined,
    contactsRequestId: input.contactsRequestId === undefined ? undefined : compact(input.contactsRequestId) || null,
    historyRequestId: input.historyRequestId === undefined ? undefined : compact(input.historyRequestId) || null,
    lastError: null,
  }).where(eq(metaWhatsAppOnboardings.id, input.onboardingId));
}

export async function recordWhatsAppHistoryProgress(input: {
  onboardingId: number;
  progress: number;
  phase?: number | null;
  chunkOrder?: number | null;
  oldestMessageAt?: Date | null;
  newestMessageAt?: Date | null;
}) {
  const db = await requireDb();
  const progress = Math.max(0, Math.min(100, Math.trunc(input.progress)));
  await db.update(metaWhatsAppOnboardings).set({
    onboardingStatus: progress >= 100 ? "history_completed" : "history_receiving",
    historyProgress: progress,
    historyPhase: input.phase ?? null,
    lastChunkOrder: input.chunkOrder ?? null,
    oldestMessageAt: input.oldestMessageAt ?? undefined,
    newestMessageAt: input.newestMessageAt ?? undefined,
    lastHistoryWebhookAt: new Date(),
    completedAt: progress >= 100 ? new Date() : null,
    lastError: null,
  }).where(eq(metaWhatsAppOnboardings.id, input.onboardingId));
}

export async function markWhatsAppHistoryDeclined(onboardingId: number, message: string) {
  const db = await requireDb();
  await db.update(metaWhatsAppOnboardings).set({ onboardingStatus: "history_declined", lastHistoryWebhookAt: new Date(), lastError: compact(message, 500) || "رفض المتجر مشاركة سجل WhatsApp." }).where(eq(metaWhatsAppOnboardings.id, onboardingId));
}

export async function markWhatsAppOffboarded(wabaId: string, message?: string | null) {
  const db = await requireDb();
  await db.update(metaWhatsAppOnboardings).set({ onboardingStatus: "offboarded", lastError: compact(message, 500) || "تم فصل WhatsApp Business عن المنصة." }).where(eq(metaWhatsAppOnboardings.wabaId, compact(wabaId)));
}
