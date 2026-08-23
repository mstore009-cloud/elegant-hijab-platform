import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { ENV } from "../../_core/env";

function encryptionKey() {
  if (!ENV.cookieSecret) throw new Error("مفتاح تشفير المنصة غير متاح.");
  return createHash("sha256").update(ENV.cookieSecret).digest();
}

export function encryptOneDriveToken(plainText: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptOneDriveToken(cipherText: string) {
  const [ivText, tagText, dataText] = cipherText.split(".");
  if (!ivText || !tagText || !dataText) throw new Error("صيغة رمز OneDrive المشفر غير صالحة.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}
