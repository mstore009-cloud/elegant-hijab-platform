import { eq } from "drizzle-orm";
import { aiTaskConfigurations } from "../../drizzle/schema";
import { getDb } from "../db";
import { invokeProvider } from "./providers";
import { assertAiTaskAllowance, getActiveAiPricingCard, getAiConnection, recordAiUsage } from "./db";
import type { AiTask, AiTaskResult, ProviderRequest } from "./types";

function estimateCost(inputTokens: number, outputTokens: number, imageUnits: number, pricing: { inputPerMillion: string; outputPerMillion: string; imagePerUnit: string } | null) {
  if (!pricing) return { amount: "0", version: null };
  const amount = (Number(pricing.inputPerMillion) * inputTokens / 1_000_000) + (Number(pricing.outputPerMillion) * outputTokens / 1_000_000) + (Number(pricing.imagePerUnit) * imageUnits);
  return { amount: amount.toFixed(6), version: null };
}

export async function resolveAiTask(task: AiTask) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [config] = await db.select().from(aiTaskConfigurations).where(eq(aiTaskConfigurations.task, task)).limit(1);
  if (!config?.enabled || !config.providerConnectionId) throw new Error(`مهمة AI غير مفعلة: ${task}`);
  const connection = await getAiConnection(config.providerConnectionId);
  if (!connection || connection.status !== "verified" || !connection.enabled) throw new Error("اتصال مزود AI غير جاهز لهذه المهمة.");
  return { config, connection };
}

export async function routeAiTask(input: { task: AiTask; messages: ProviderRequest["messages"]; storeId?: number | null; customerId?: number | null; conversationId?: number | null; responseFormat?: ProviderRequest["responseFormat"] }) : Promise<AiTaskResult> {
  const { config, connection } = await resolveAiTask(input.task);
  const allowance = await assertAiTaskAllowance({ task: input.task, config });
  if (!allowance.allowed) {
    await recordAiUsage({ provider: connection.provider, providerConnectionId: connection.id, task: input.task, model: config.model, storeId: input.storeId, customerId: input.customerId, conversationId: input.conversationId, inputTokens: 0, outputTokens: 0, estimatedCost: "0", status: "rejected_quota", errorCode: allowance.reason });
    throw new Error(`${allowance.reason} الإجراء المحدد: ${config.overLimitAction}.`);
  }
  const request: ProviderRequest = { provider: connection.provider, model: config.model, messages: input.messages, maxTokens: config.maxTokens, timeoutMs: config.timeoutMs, responseFormat: input.responseFormat };
  try {
    const result = await invokeProvider({ id: connection.id, provider: connection.provider, displayName: connection.displayName, encryptedApiKey: connection.encryptedApiKey }, request);
    const pricing = await getActiveAiPricingCard(connection.provider, config.model);
    const cost = estimateCost(result.inputTokens, result.outputTokens, result.imageUnits, pricing);
    await recordAiUsage({ provider: connection.provider, providerConnectionId: connection.id, task: input.task, model: result.model, storeId: input.storeId, customerId: input.customerId, conversationId: input.conversationId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, imageUnits: result.imageUnits, estimatedCost: cost.amount, priceVersion: pricing?.version ?? null, providerRequestId: result.id, status: "succeeded" });
    return { ...result, provider: connection.provider, task: input.task, estimatedCost: cost.amount, priceVersion: pricing?.version ?? null };
  } catch (error) {
    await recordAiUsage({ provider: connection.provider, providerConnectionId: connection.id, task: input.task, model: config.model, storeId: input.storeId, customerId: input.customerId, conversationId: input.conversationId, inputTokens: 0, outputTokens: 0, estimatedCost: "0", status: "failed", errorCode: error instanceof Error ? error.message.slice(0, 120) : "provider_error" });
    throw error;
  }
}
