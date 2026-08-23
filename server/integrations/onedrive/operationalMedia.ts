import sharp from "sharp";

export const OPERATIONAL_MEDIA_POLICY = {
  maxInputBytes: 25 * 1024 * 1024,
  maxWidth: 1280,
  maxHeight: 1700,
  quality: 82,
  format: "webp" as const,
};

export type OperationalMediaMetadata = {
  source: "onedrive_original";
  format: "webp";
  quality: number;
  maxWidth: number;
  maxHeight: number;
  width: number;
  height: number;
  outputBytes: number;
  createdAt: string;
};

export async function createOperationalImageDerivative(sourceBytes: Buffer) {
  if (sourceBytes.length === 0) throw new Error("ملف الصورة الأصلي فارغ.");
  if (sourceBytes.length > OPERATIONAL_MEDIA_POLICY.maxInputBytes) {
    throw new Error("حجم الصورة الأصلية أكبر من حد النسخة التشغيلية (25 ميغابايت).");
  }

  const transformed = await sharp(sourceBytes, { failOn: "error" })
    .rotate()
    .resize({
      width: OPERATIONAL_MEDIA_POLICY.maxWidth,
      height: OPERATIONAL_MEDIA_POLICY.maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: OPERATIONAL_MEDIA_POLICY.quality })
    .toBuffer({ resolveWithObject: true });

  const metadata: OperationalMediaMetadata = {
    source: "onedrive_original",
    format: "webp",
    quality: OPERATIONAL_MEDIA_POLICY.quality,
    maxWidth: OPERATIONAL_MEDIA_POLICY.maxWidth,
    maxHeight: OPERATIONAL_MEDIA_POLICY.maxHeight,
    width: transformed.info.width,
    height: transformed.info.height,
    outputBytes: transformed.info.size,
    createdAt: new Date().toISOString(),
  };

  return { bytes: transformed.data, metadata };
}
