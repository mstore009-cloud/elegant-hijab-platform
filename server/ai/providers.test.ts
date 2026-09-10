import { describe, expect, it, vi } from "vitest";
vi.mock("./secretCipher", () => ({ decryptAiSecret: vi.fn(() => "gemini-secret"), aiSecretContext: vi.fn(() => "context") }));
import { invokeProvider, listProviderModels } from "./providers";

describe("AI provider adapters", () => {
  it("uses a header rather than a query string for Gemini keys", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ models: [{ name: "models/gemini-test", displayName: "Gemini Test", supportedGenerationMethods: ["generateContent"] }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const models = await listProviderModels("gemini", "gemini-secret");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).not.toContain("gemini-secret");
    expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("gemini-secret");
    expect(models[0]?.id).toBe("gemini-test");
    fetchMock.mockRestore();
  });

  it("sends Gemini image inputs as inline data and forwards the JSON schema", async () => {
    const imageFetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }));
    const apiFetch = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ responseId: "gemini-request", candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 } }), { status: 200, headers: { "content-type": "application/json" } }));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(imageFetch as typeof fetch)
      .mockImplementationOnce(apiFetch as typeof fetch);
    const result = await invokeProvider({ id: 1, provider: "gemini", displayName: "Gemini Production", encryptedApiKey: "encrypted" }, {
      provider: "gemini",
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: [{ type: "text", text: "حلل الصورة" }, { type: "image_url", image_url: { url: "https://example.test/image.png" } }] }],
      maxTokens: 100,
      timeoutMs: 5_000,
      responseFormat: { type: "json_schema", json_schema: { name: "image_result", strict: true, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } },
    });
    const body = JSON.parse(String(apiFetch.mock.calls[0]?.[1]?.body));
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe("image/png");
    expect(body.contents[0].parts[1].inlineData.data).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    expect(body.generationConfig.responseSchema.properties.ok.type).toBe("boolean");
    expect(result.text).toBe('{"ok":true}');
    expect(result.inputTokens).toBe(12);
    fetchMock.mockRestore();
  });

  it("uses max_completion_tokens for gpt-5 models", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "openai-request", model: "gpt-5", choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 3 } }), { status: 200, headers: { "content-type": "application/json" } }));
    await invokeProvider({ id: 1, provider: "openai", displayName: "OpenAI Production", encryptedApiKey: "encrypted" }, {
      provider: "openai",
      model: "gpt-5",
      messages: [{ role: "user", content: "اختبار" }],
      maxTokens: 1800,
      timeoutMs: 5_000,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.max_completion_tokens).toBe(1800);
    expect(body.max_tokens).toBeUndefined();
    fetchMock.mockRestore();
  });
});
