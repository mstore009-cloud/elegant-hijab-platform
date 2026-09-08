import { describe, expect, it } from "vitest";
import { absoluteMetaCatalogSourceUrl } from "./catalogMediaPreparation";

describe("Meta Catalog media source URL", () => {
  it("converts a relative Manus storage path into a public URL before server-side reading", () => {
    const url = absoluteMetaCatalogSourceUrl("/manus-storage/products/1/manual-post-media/video.mp4");
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain("/manus-storage/products/1/manual-post-media/video.mp4");
  });

  it("preserves an already public storage URL", () => {
    expect(absoluteMetaCatalogSourceUrl("https://storage.example/video.mp4")).toBe("https://storage.example/video.mp4");
  });
});
