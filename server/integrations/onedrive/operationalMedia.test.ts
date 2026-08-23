import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createOperationalImageDerivative, OPERATIONAL_MEDIA_POLICY } from "./operationalMedia";

describe("النسخة التشغيلية للوسائط", () => {
  it("تحول الصورة إلى WebP محدود الأبعاد من دون تغيير بايتات المصدر", async () => {
    const source = await sharp({
      create: { width: 2400, height: 2000, channels: 3, background: { r: 100, g: 60, b: 70 } },
    }).png().toBuffer();
    const snapshot = Buffer.from(source);

    const result = await createOperationalImageDerivative(source);

    expect(source.equals(snapshot)).toBe(true);
    expect(result.metadata.format).toBe("webp");
    expect(result.metadata.quality).toBe(OPERATIONAL_MEDIA_POLICY.quality);
    expect(result.metadata.width).toBeLessThanOrEqual(OPERATIONAL_MEDIA_POLICY.maxWidth);
    expect(result.metadata.height).toBeLessThanOrEqual(OPERATIONAL_MEDIA_POLICY.maxHeight);
    expect(result.bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });
});
