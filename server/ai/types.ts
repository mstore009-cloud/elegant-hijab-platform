import type { Message, ResponseFormat } from "../_core/llm";
import type { AiTaskConfiguration, AiProviderConnection } from "../../drizzle/schema";

export type AiProvider = "openai" | "gemini" | "anthropic";
export type AiTask = "customer_reply_fast" | "customer_reply_escalation" | "product_image_analysis" | "customer_image_analysis" | "image_product_matching" | "marketing_analysis" | "content_generation";

export type ProviderRequest = {
  provider: AiProvider;
  model: string;
  messages: Message[];
  maxTokens: number;
  timeoutMs: number;
  responseFormat?: ResponseFormat;
};

export type ProviderResponse = {
  id: string;
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  imageUnits: number;
  finishReason: string | null;
};

export type ProviderModel = { id: string; displayName?: string; supportsVision?: boolean };

export type AiTaskResolution = {
  connection: AiProviderConnection;
  task: AiTaskConfiguration;
};

export type AiProviderRuntimeConnection = {
  id: number;
  provider: AiProvider;
  displayName: string;
  encryptedApiKey: string | null;
};

export type AiTaskResult = ProviderResponse & {
  provider: AiProvider;
  task: AiTask;
  estimatedCost: string;
  priceVersion: string | null;
};
