import { desc, eq, gte, sql } from "drizzle-orm";
import { aiPricingCards, aiProviderConnections, aiTaskConfigurations, aiTaskNames, aiUsageLedger } from "../../drizzle/schema";
import { getDb } from "../db";
import { encryptAiSecret, decryptAiSecret, aiSecretContext } from "./secretCipher";
import { listProviderModels, testProviderConnection } from "./providers";
import type { AiProvider, AiTask } from "./types";

const defaultTaskModels: Record<AiTask, { provider: AiProvider; model: string }> = {
  customer_reply_fast: { provider: "openai", model: "gpt-4o-mini" },
  customer_reply_escalation: { provider: "openai", model: "gpt-4o" },
  product_image_analysis: { provider: "gemini", model: "gemini-2.0-flash" },
  customer_image_analysis: { provider: "gemini", model: "gemini-2.0-flash" },
  image_product_matching: { provider: "gemini", model: "gemini-2.0-flash" },
  marketing_analysis: { provider: "openai", model: "gpt-4o-mini" },
  content_generation: { provider: "openai", model: "gpt-4o-mini" },
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

export async function ensureDefaultAiTasks() {
  const db = await requireDb();
  const existing = await db.select({ task: aiTaskConfigurations.task }).from(aiTaskConfigurations);
  const known = new Set(existing.map(row => row.task));
  const missing = aiTaskNames.filter(task => !known.has(task));
  if (missing.length) await db.insert(aiTaskConfigurations).values(missing.map(task => ({ task, model: defaultTaskModels[task].model, enabled: false })));
}

export async function listAiConnections() {
  const db = await requireDb();
  return db.select({ id: aiProviderConnections.id, provider: aiProviderConnections.provider, displayName: aiProviderConnections.displayName, connectionType: aiProviderConnections.connectionType, status: aiProviderConnections.status, enabled: aiProviderConnections.enabled, lastTestedAt: aiProviderConnections.lastTestedAt, lastError: aiProviderConnections.lastError, updatedAt: aiProviderConnections.updatedAt }).from(aiProviderConnections).orderBy(aiProviderConnections.provider, aiProviderConnections.id);
}

export async function getAiConnection(id: number) {
  const db = await requireDb();
  const [row] = await db.select().from(aiProviderConnections).where(eq(aiProviderConnections.id, id)).limit(1);
  return row ?? null;
}

export async function saveAiConnection(input: { id?: number; provider: AiProvider; displayName: string; connectionType?: "api_key" | "vertex_ai"; apiKey?: string; enabled: boolean; actorUserId: number }) {
  const db = await requireDb();
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("أدخل اسمًا واضحًا للاتصال.");
  if (input.connectionType === "vertex_ai") throw new Error("Vertex AI محجوز لمرحلة لاحقة؛ استخدم مفتاح Gemini في الإصدار الأول.");
  const current = input.id ? await getAiConnection(input.id) : null;
  if (input.id && !current) throw new Error("اتصال AI غير موجود.");
  const apiKey = input.apiKey?.trim();
  if (current && current.displayName !== displayName && !apiKey) throw new Error("أدخل المفتاح من جديد عند تغيير اسم الاتصال.");
  if (!current && !apiKey) throw new Error("أدخل مفتاح API عند إنشاء الاتصال.");
  if (current && !current.encryptedApiKey && !apiKey) throw new Error("أدخل مفتاح API لإكمال الاتصال.");
  const values = { provider: input.provider, displayName, connectionType: "api_key" as const, encryptedApiKey: apiKey ? encryptAiSecret(apiKey, aiSecretContext(input.provider, displayName)) : current!.encryptedApiKey, status: apiKey ? "untested" as const : current!.status, enabled: apiKey ? false : input.enabled, lastError: null, updatedByUserId: input.actorUserId };
  if (current) await db.update(aiProviderConnections).set(values).where(eq(aiProviderConnections.id, current.id));
  else await db.insert(aiProviderConnections).values(values);
  return listAiConnections();
}

export async function testAiConnection(input: { id?: number; provider: AiProvider; apiKey?: string; displayName?: string }) {
  const db = await requireDb();
  const connection = input.id ? await getAiConnection(input.id) : null;
  const plainKey = input.apiKey?.trim() || (connection?.encryptedApiKey ? decryptAiSecret(connection.encryptedApiKey, aiSecretContext(connection.provider, connection.id)) : "");
  if (!plainKey) throw new Error("لا يوجد مفتاح لاختباره.");
  const result = await testProviderConnection(input.provider, plainKey);
  if (connection) await db.update(aiProviderConnections).set({ status: "verified", enabled: true, lastTestedAt: new Date(), lastError: null }).where(eq(aiProviderConnections.id, connection.id));
  return result;
}

export async function listAiModels(input: { id: number }) {
  const connection = await getAiConnection(input.id);
  if (!connection?.encryptedApiKey) throw new Error("أكمل الاتصال واختبر المفتاح أولًا.");
  const key = decryptAiSecret(connection.encryptedApiKey, aiSecretContext(connection.provider, connection.displayName));
  return listProviderModels(connection.provider, key);
}

export async function listAiTasks() {
  await ensureDefaultAiTasks();
  const db = await requireDb();
  return db.select().from(aiTaskConfigurations).orderBy(aiTaskConfigurations.id);
}

export async function updateAiTask(input: { task: AiTask; providerConnectionId: number | null; model: string; enabled: boolean; maxTokens: number; timeoutMs: number; maxRetries: number; fallbackEnabled: boolean; dailyQuota: number | null; monthlyQuota: number | null; monthlyBudget: string | null; overLimitAction: "pause" | "draft_only" | "handoff"; actorUserId: number }) {
  const db = await requireDb();
  const connection = input.providerConnectionId ? await getAiConnection(input.providerConnectionId) : null;
  if (input.enabled && (!connection || connection.status !== "verified" || !connection.enabled)) throw new Error("لا يمكن تفعيل المهمة قبل التحقق من اتصال المزود وتفعيله.");
  await db.update(aiTaskConfigurations).set({ providerConnectionId: input.providerConnectionId, model: input.model.trim(), enabled: input.enabled, maxTokens: input.maxTokens, timeoutMs: input.timeoutMs, maxRetries: input.maxRetries, fallbackEnabled: input.fallbackEnabled, dailyQuota: input.dailyQuota, monthlyQuota: input.monthlyQuota, monthlyBudget: input.monthlyBudget, overLimitAction: input.overLimitAction, updatedByUserId: input.actorUserId }).where(eq(aiTaskConfigurations.task, input.task));
  return listAiTasks();
}

export async function getAiOverview() {
  await ensureDefaultAiTasks();
  const [connections, tasks] = await Promise.all([listAiConnections(), listAiTasks()]);
  const db = await requireDb();
  const [summary] = await db.select({ calls: sql<number>`count(*)`, estimatedCost: sql<string>`coalesce(sum(${aiUsageLedger.estimatedCost}), 0)`, failed: sql<number>`sum(case when ${aiUsageLedger.status} = 'failed' then 1 else 0 end)` }).from(aiUsageLedger).where(gte(aiUsageLedger.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  return { connections, tasks, summary: { calls: Number(summary?.calls ?? 0), estimatedCost: String(summary?.estimatedCost ?? "0"), failed: Number(summary?.failed ?? 0) } };
}

export async function listAiUsage(limit = 100) {
  const db = await requireDb();
  return db.select({ id: aiUsageLedger.id, provider: aiUsageLedger.provider, task: aiUsageLedger.task, model: aiUsageLedger.model, storeId: aiUsageLedger.storeId, inputTokens: aiUsageLedger.inputTokens, outputTokens: aiUsageLedger.outputTokens, imageUnits: aiUsageLedger.imageUnits, estimatedCost: aiUsageLedger.estimatedCost, currency: aiUsageLedger.currency, status: aiUsageLedger.status, errorCode: aiUsageLedger.errorCode, createdAt: aiUsageLedger.createdAt }).from(aiUsageLedger).orderBy(desc(aiUsageLedger.createdAt)).limit(limit);
}

export async function recordAiUsage(input: { provider: AiProvider; providerConnectionId?: number | null; task: AiTask; model: string; storeId?: number | null; customerId?: number | null; conversationId?: number | null; inputTokens: number; outputTokens: number; imageUnits?: number; estimatedCost: string; currency?: string; priceVersion?: string | null; providerRequestId?: string | null; status: "reserved" | "succeeded" | "failed" | "rejected_quota"; errorCode?: string | null }) {
  const db = await requireDb();
  await db.insert(aiUsageLedger).values({ ...input, providerConnectionId: input.providerConnectionId ?? null, storeId: input.storeId ?? null, customerId: input.customerId ?? null, conversationId: input.conversationId ?? null, imageUnits: input.imageUnits ?? 0, currency: input.currency ?? "USD", priceVersion: input.priceVersion ?? null, providerRequestId: input.providerRequestId ?? null, errorCode: input.errorCode ?? null });
}
