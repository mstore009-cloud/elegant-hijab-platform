import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { channelAccounts, inboxMessageMedia } from "../../drizzle/schema";
import { getDb } from "../db";
import { getMetaRuntimeSettings } from "../integrations/meta/platformSettings";
import { storagePut } from "../storage";
import { loadMetaCredential } from "./metaOutbound";

const MAX_WHATSAPP_MEDIA_BYTES = 20 * 1024 * 1024;
const MAX_INSTAGRAM_MEDIA_BYTES = 20 * 1024 * 1024;
const SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "video/mp4", "video/webm", "audio/mpeg", "audio/ogg", "audio/wav", "application/pdf", "text/plain"]);

type FetchLike = typeof fetch;
type StoragePutter = (relativeKey: string, data: Buffer, contentType?: string) => Promise<{ key: string; url: string }>;

function getExtension(mimeType: string) {
  return mimeType === "image/png" ? "png" : mimeType === "video/mp4" ? "mp4" : mimeType === "video/webm" ? "webm" : mimeType === "audio/mpeg" ? "mp3" : mimeType === "audio/ogg" ? "ogg" : mimeType === "audio/wav" ? "wav" : mimeType === "application/pdf" ? "pdf" : mimeType === "text/plain" ? "txt" : "jpg";
}

function compactError(error: unknown) {
  return (error instanceof Error ? error.message : "تعذر تنزيل مرفق الرسالة.").slice(0, 500);
}

function validHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

async function getWhatsAppMediaUrl(providerMediaId: string, phoneNumberId: string, accessToken: string, graphApiVersion: string, fetcher: FetchLike) {
  const endpoint = new URL(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(providerMediaId)}`);
  endpoint.searchParams.set("phone_number_id", phoneNumberId);
  const response = await fetcher(endpoint, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`تعذر الحصول على رابط وسائط واتساب (${response.status}).`);
  const payload = await response.json() as { url?: string; mime_type?: string };
  if (!payload.url || !validHttpsUrl(payload.url)) throw new Error("لم يرجع مزود القناة رابط وسائط صالحاً.");
  return { url: payload.url, mimeType: payload.mime_type ?? null };
}

/** Downloads one already-recorded customer image and turns the short provider URL into a durable store-scoped S3 object. */
export async function storeInboundImageFromProvider(input: { storeId: number; mediaId: number; sourceUrl?: string | null; fetcher?: FetchLike; putter?: StoragePutter }) {
  const db = await requireDb();
  const [media] = await db.select().from(inboxMessageMedia).where(and(eq(inboxMessageMedia.id, input.mediaId), eq(inboxMessageMedia.storeId, input.storeId))).limit(1);
  if (!media) throw new Error("مرفق الرسالة غير موجود في المتجر التشغيلي الحالي.");
  if (!["image", "video", "audio", "document"].includes(media.mediaType)) return { status: "unsupported" as const, media };
  if (media.downloadStatus === "stored" && media.storageKey) return { status: "stored" as const, media };
  const [account] = media.channelAccountId ? await db.select().from(channelAccounts).where(and(eq(channelAccounts.id, media.channelAccountId), eq(channelAccounts.storeId, input.storeId))).limit(1) : [];
  if (!account) throw new Error("حساب القناة المرتبط بالمرفق غير موجود ضمن المتجر الحالي.");

  const fetcher = input.fetcher ?? fetch;
  try {
    let credential: Awaited<ReturnType<typeof loadMetaCredential>> | null = null;
    try { credential = await loadMetaCredential(input.storeId, account); } catch { /* Signed source URLs can be downloaded without a delegated header. */ }
    const runtime = await getMetaRuntimeSettings();
    const providerAsset = input.sourceUrl && validHttpsUrl(input.sourceUrl)
      ? { url: input.sourceUrl, mimeType: media.mimeType }
      : account.channel === "whatsapp" && media.providerMediaId && account.providerAccountId
        ? credential ? await getWhatsAppMediaUrl(media.providerMediaId, account.providerAccountId, credential.accessToken, runtime.graphApiVersion, fetcher) : null
        : null;
    if (!providerAsset) throw new Error("لا يتوفر رابط تنزيل مؤقت صالح لمرفق القناة.");
    const response = await fetcher(providerAsset.url, { headers: credential ? { Authorization: `Bearer ${credential.accessToken}` } : undefined, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`تعذر تنزيل مرفق الرسالة (${response.status}).`);
    const contentType = (response.headers.get("content-type") || providerAsset.mimeType || media.mimeType || "").split(";")[0].trim().toLowerCase();
    if (!SUPPORTED_MEDIA_TYPES.has(contentType)) throw new Error("نوع مرفق الرسالة غير مدعوم. يُسمح بصور JPEG/PNG وفيديو MP4/WebM وصوت MP3/OGG/WAV ومستندات PDF/TXT.");
    const maxBytes = account.channel === "whatsapp" ? MAX_WHATSAPP_MEDIA_BYTES : MAX_INSTAGRAM_MEDIA_BYTES;
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("حجم مرفق الرسالة يتجاوز الحد الآمن للقناة.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error("مرفق الرسالة فارغ.");
    if (bytes.length > maxBytes) throw new Error("حجم مرفق الرسالة يتجاوز الحد الآمن للقناة.");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const stored = await (input.putter ?? storagePut)(`stores/${input.storeId}/inbox/${media.messageId}/customer-media.${getExtension(contentType)}`, bytes, contentType);
    await db.update(inboxMessageMedia).set({ storageKey: stored.key, mimeType: contentType, sizeBytes: bytes.length, sha256, downloadStatus: "stored", errorSummary: null }).where(eq(inboxMessageMedia.id, media.id));
    return { status: "stored" as const, media: { ...media, storageKey: stored.key, mimeType: contentType, sizeBytes: bytes.length, sha256, downloadStatus: "stored" as const } };
  } catch (error) {
    const errorSummary = compactError(error);
    await db.update(inboxMessageMedia).set({ downloadStatus: "failed", errorSummary }).where(eq(inboxMessageMedia.id, media.id));
    return { status: "failed" as const, media: { ...media, downloadStatus: "failed" as const, errorSummary } };
  }
}
