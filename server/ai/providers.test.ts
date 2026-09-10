import { describe, expect, it, vi } from "vitest";
import { listProviderModels } from "./providers";

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
});
