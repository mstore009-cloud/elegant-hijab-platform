import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("performance delivery", () => {
  it("configures shared vendor chunks and Brotli asset generation", () => {
    const vite = read("vite.config.ts");
    const server = read("server/_core/vite.ts");
    expect(vite).toContain("manualChunks");
    expect(vite).toContain("brotli-assets");
    expect(vite).toContain("BROTLI_PARAM_QUALITY");
    expect(server).toContain("Content-Encoding");
    expect(server).toContain("max-age=31536000, immutable");
  });

  it("records first open and route navigation metrics in the browser", () => {
    const app = read("client/src/App.tsx");
    const performance = read("client/src/performance.ts");
    expect(app).toContain("PerformanceTelemetry");
    expect(app).toContain('"first_open"');
    expect(app).toContain('"route_navigation"');
    expect(performance).toContain("__platformPerformance");
    expect(performance).toContain("platform:performance");
  });
});
