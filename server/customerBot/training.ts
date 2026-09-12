import { and, desc, eq } from "drizzle-orm";
import { customerBotKnowledgeArticles, customerBotTrainingAssets } from "../../drizzle/schema";
import { getDb } from "../db";
import { storagePut } from "../storage";
import { transcribeAudio } from "../_core/voiceTranscription";
import { ENV } from "../_core/env";

const maxBytes = 16 * 1024 * 1024;
const audioTypes = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/m4a"]);
const textTypes = new Set(["text/plain", "text/markdown", "application/json"]);

async function requireDb() { const db = await getDb(); if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا."); return db; }
function publicUrl(path: string) { try { return new URL(path, new URL(ENV.metaRedirectUri).origin).toString(); } catch { throw new Error("لا يتوفر النطاق العام اللازم لتحويل الملف الصوتي إلى نص."); } }
function cleanText(value: string) { return value.replace(/\u0000/g, "").trim().slice(0, 12000); }

export async function uploadCustomerBotTrainingAsset(input: { storeId: number; actorUserId: number; fileName: string; mimeType: string; base64: string }) {
  const buffer = Buffer.from(input.base64, "base64");
  if (!buffer.length || buffer.length > maxBytes) throw new Error("الملف يجب أن يكون بين 1 بايت و16 ميغابايت.");
  const mimeType = input.mimeType.trim().toLowerCase();
  const kind = audioTypes.has(mimeType) ? "audio" as const : textTypes.has(mimeType) ? "text" as const : null;
  if (!kind) throw new Error("الأنواع المدعومة للتدريب هي TXT وMD وJSON وMP3 وWAV وM4A وOGG وWEBM.");
  const db = await requireDb();
  const safeName = input.fileName.trim().slice(0, 255) || `training.${kind === "audio" ? "audio" : "txt"}`;
  const stored = await storagePut(`bot-training/${input.storeId}/${Date.now()}-${safeName.replace(/[^a-zA-Z0-9._-]/g, "-")}`, buffer, mimeType);
  let transcript: string | null = null;
  let errorSummary: string | null = null;
  if (kind === "text") transcript = cleanText(buffer.toString("utf8"));
  else {
    const result = await transcribeAudio({ audioUrl: publicUrl(stored.url), language: "ar", prompt: "النص باللهجة العراقية. احتفظ بالمفردات المحلية كما قيلت ولا تصححها إلى فصحى." });
    if ("error" in result) errorSummary = `${result.error}${result.details ? `: ${result.details}` : ""}`.slice(0, 500);
    else transcript = cleanText(result.text);
  }
  const created = await db.insert(customerBotTrainingAssets).values({ storeId: input.storeId, kind, status: errorSummary ? "failed" : "ready", storageKey: stored.key, originalFileName: safeName, mimeType, byteSize: buffer.byteLength, transcript, errorSummary, createdByUserId: input.actorUserId });
  const [asset] = await db.select().from(customerBotTrainingAssets).where(eq(customerBotTrainingAssets.id, Number(created[0].insertId))).limit(1);
  if (!asset) throw new Error("تعذر حفظ مصدر التدريب.");
  return asset;
}

export async function listCustomerBotTrainingAssets(storeId: number) { const db = await requireDb(); return db.select().from(customerBotTrainingAssets).where(eq(customerBotTrainingAssets.storeId, storeId)).orderBy(desc(customerBotTrainingAssets.createdAt)).limit(30); }

export async function createStyleCandidateFromTrainingAsset(input: { storeId: number; actorUserId: number; assetId: number; title?: string }) {
  const db = await requireDb();
  const [asset] = await db.select().from(customerBotTrainingAssets).where(and(eq(customerBotTrainingAssets.id, input.assetId), eq(customerBotTrainingAssets.storeId, input.storeId), eq(customerBotTrainingAssets.status, "ready"))).limit(1);
  if (!asset?.transcript) throw new Error("مصدر التدريب لا يحمل نصاً صالحاً للتحويل إلى مرشح لهجة.");
  const body = `مصدر تدريب لهجة قابل للمراجعة:\n${asset.transcript}\n\nنطاق الاستخدام: استخراج النبرة والمفردات المهذبة فقط. لا تستخدم أي سعر أو توفر أو معلومات عميل واردة في هذا المصدر كحقيقة تشغيلية.`;
  const existing = await db.select({ id: customerBotKnowledgeArticles.id }).from(customerBotKnowledgeArticles).where(and(eq(customerBotKnowledgeArticles.storeId, input.storeId), eq(customerBotKnowledgeArticles.source, "review_feedback"), eq(customerBotKnowledgeArticles.body, body))).limit(1);
  if (existing[0]) return { articleId: existing[0].id, created: false };
  const created = await db.insert(customerBotKnowledgeArticles).values({ storeId: input.storeId, title: (input.title?.trim() || `مرشح لهجة من ${asset.originalFileName}`).slice(0, 240), kind: "style_guidance", body, source: "review_feedback", status: "draft", createdByUserId: input.actorUserId });
  return { articleId: Number(created[0].insertId), created: true };
}
