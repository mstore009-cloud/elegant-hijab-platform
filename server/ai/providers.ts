import type { Message, MessageContent } from "../_core/llm";
import { decryptAiSecret, aiSecretContext } from "./secretCipher";
import type { AiProvider, AiProviderRuntimeConnection, ProviderModel, ProviderRequest, ProviderResponse } from "./types";

function providerError(provider: string, status: number, body: string) {
  const message = body.slice(0, 500).replace(/sk-[A-Za-z0-9_-]+/g, "[secret]");
  return new Error(`${provider} API ${status}: ${message}`);
}

function contentParts(content: Message["content"]): MessageContent[] {
  if (typeof content === "string") return [content];
  return Array.isArray(content) ? content : [content];
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(Math.max(1000, timeoutMs)) });
  const body = await response.text();
  let payload: any = null;
  try { payload = body ? JSON.parse(body) : null; } catch { /* handled below */ }
  if (!response.ok) throw providerError("AI", response.status, body || response.statusText);
  return payload;
}

function toOpenAiMessages(messages: Message[]) {
  return messages.map(message => {
    const parts = contentParts(message.content);
    const content = typeof message.content === "string"
      ? message.content
      : parts.map(part => {
        if (typeof part === "string") return part;
        if (part.type === "text") return part.text;
        if (part.type === "image_url") return { type: "image_url", image_url: part.image_url };
        return { type: "file", file: part.file_url };
      });
    return { role: message.role === "function" ? "tool" : message.role, content };
  });
}

function parseDataUrl(url: string) {
  const match = url.match(/^data:([^;,]+)?;base64,([\s\S]+)$/);
  if (!match) return null;
  return { mimeType: match[1] || "application/octet-stream", data: match[2] };
}

async function toGeminiImagePart(url: string, timeoutMs: number) {
  const dataUrl = parseDataUrl(url);
  if (dataUrl) return { inlineData: { mimeType: dataUrl.mimeType, data: dataUrl.data } };
  const response = await fetch(url, { signal: AbortSignal.timeout(Math.max(1000, timeoutMs)) });
  if (!response.ok) throw new Error(`تعذر تنزيل صورة الإدخال لتحليل Gemini: ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  if (!contentType.startsWith("image/")) throw new Error("رابط صورة الإدخال لا يعيد نوع ملف صورة صالحًا.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 12 * 1024 * 1024) throw new Error("صورة الإدخال أكبر من الحد الآمن لتحليل Gemini.");
  return { inlineData: { mimeType: contentType, data: buffer.toString("base64") } };
}

async function toGeminiContents(messages: Message[], timeoutMs: number) {
  const contents = await Promise.all(messages
    .filter(message => message.role !== "system")
    .map(async message => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: await Promise.all(contentParts(message.content).map(async part => {
        if (typeof part === "string") return { text: part };
        if (part.type === "text") return { text: part.text };
        if (part.type === "image_url") return toGeminiImagePart(part.image_url.url, timeoutMs);
        return { text: `[file: ${part.file_url.url}]` };
      })),
    })));
  const system = messages.find(message => message.role === "system");
  const systemText = system ? contentParts(system.content).map(part => typeof part === "string" ? part : part.type === "text" ? part.text : "").join("\n") : undefined;
  return { contents, systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined };
}

function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(item => toGeminiSchema(item));
  if (!schema || typeof schema !== "object") return schema;
  const source = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "additionalProperties" || key === "name" || key === "strict" || key === "$schema") continue;
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      result.properties = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([property, propertySchema]) => [property, toGeminiSchema(propertySchema)]));
      continue;
    }
    if (key === "type" && Array.isArray(value)) {
      const types = value.filter(item => item !== "null");
      if (types.length === 1) result.type = types[0];
      if (value.includes("null")) result.nullable = true;
      continue;
    }
    result[key] = toGeminiSchema(value);
  }
  return result;
}

export async function listProviderModels(provider: AiProvider, apiKey: string, timeoutMs = 10_000): Promise<ProviderModel[]> {
  if (provider === "openai") {
    const payload = await fetchJson("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${apiKey}` } }, timeoutMs);
    return (payload?.data ?? []).filter((model: any) => typeof model?.id === "string").map((model: any) => ({ id: model.id, displayName: model.id, supportsVision: /gpt|vision|o[1-9]/i.test(model.id) })).sort((a: ProviderModel, b: ProviderModel) => a.id.localeCompare(b.id));
  }
  if (provider === "gemini") {
    const payload = await fetchJson("https://generativelanguage.googleapis.com/v1beta/models", { headers: { "x-goog-api-key": apiKey } }, timeoutMs);
    return (payload?.models ?? []).filter((model: any) => typeof model?.name === "string").map((model: any) => ({ id: String(model.name).replace(/^models\//, ""), displayName: model.displayName, supportsVision: Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent") })).filter((model: ProviderModel) => model.id.length > 0).sort((a: ProviderModel, b: ProviderModel) => a.id.localeCompare(b.id));
  }
  throw new Error("هذا المزود غير مدعوم في الإصدار الأول.");
}

export async function testProviderConnection(provider: AiProvider, apiKey: string, timeoutMs = 10_000) {
  const models = await listProviderModels(provider, apiKey, timeoutMs);
  return { models, modelCount: models.length };
}

export async function invokeProvider(connection: AiProviderRuntimeConnection, request: ProviderRequest): Promise<ProviderResponse> {
  if (!connection.encryptedApiKey) throw new Error("لا يوجد مفتاح API معتمد لهذا الاتصال.");
  const apiKey = decryptAiSecret(connection.encryptedApiKey, aiSecretContext(connection.provider, connection.displayName));
  if (connection.provider === "openai") {
    const usesCompletionTokens = /^(gpt-5|o[1-9])/i.test(request.model);
    const tokenLimit = usesCompletionTokens ? { max_completion_tokens: request.maxTokens } : { max_tokens: request.maxTokens };
    const payload = await fetchJson("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: request.model, messages: toOpenAiMessages(request.messages), ...tokenLimit, ...(request.responseFormat ? { response_format: request.responseFormat } : {}) }) }, request.timeoutMs);
    const choice = payload?.choices?.[0];
    return { id: String(payload?.id ?? ""), model: String(payload?.model ?? request.model), text: typeof choice?.message?.content === "string" ? choice.message.content : JSON.stringify(choice?.message?.content ?? ""), inputTokens: Number(payload?.usage?.prompt_tokens ?? 0), outputTokens: Number(payload?.usage?.completion_tokens ?? 0), imageUnits: 0, finishReason: choice?.finish_reason ?? null };
  }
  if (connection.provider === "gemini") {
    const body = await toGeminiContents(request.messages, request.timeoutMs);
    const jsonSchema = request.responseFormat?.type === "json_schema" ? request.responseFormat.json_schema : undefined;
    const payload = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({ ...body, generationConfig: { maxOutputTokens: request.maxTokens, responseMimeType: jsonSchema || request.responseFormat?.type === "json_object" ? "application/json" : "text/plain", ...(jsonSchema ? { responseSchema: toGeminiSchema(jsonSchema.schema) } : {}) } }) }, request.timeoutMs);
    const text = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: any) => part?.text ?? "").join("");
    return { id: String(payload?.responseId ?? ""), model: request.model, text, inputTokens: Number(payload?.usageMetadata?.promptTokenCount ?? 0), outputTokens: Number(payload?.usageMetadata?.candidatesTokenCount ?? 0), imageUnits: 0, finishReason: payload?.candidates?.[0]?.finishReason ?? null };
  }
  throw new Error("هذا المزود غير مدعوم في الإصدار الأول.");
}
