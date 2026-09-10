import { describe, expect, it } from "vitest";
import { decryptAiSecret, encryptAiSecret } from "./secretCipher";

describe("AI secret cipher", () => {
  it("round-trips a secret with authenticated context", () => {
    const cipher = encryptAiSecret("sk-test-secret", "ai-provider:openai:Production");
    expect(cipher).not.toContain("sk-test-secret");
    expect(decryptAiSecret(cipher, "ai-provider:openai:Production")).toBe("sk-test-secret");
  });

  it("rejects a changed context", () => {
    const cipher = encryptAiSecret("gemini-secret", "ai-provider:gemini:Vision");
    expect(() => decryptAiSecret(cipher, "ai-provider:gemini:Other")).toThrow();
  });
});
