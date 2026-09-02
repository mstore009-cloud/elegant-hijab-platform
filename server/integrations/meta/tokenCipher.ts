import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { ENV } from "../../_core/env";

function encryptionKey() {
  if (!ENV.cookieSecret) throw new Error("مفتاح تشفير المنصة غير متاح.");
  return createHash("sha256").update(ENV.cookieSecret).digest();
}

export function encryptMetaToken(plainText: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptMetaToken(cipherText: string, context: string) {
  const [ivText, tagText, dataText] = cipherText.split(".");
  if (!ivText || !tagText || !dataText) throw new Error("صيغة رمز Meta المشفر غير صالحة.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

export function metaConnectionTokenContext(storeId: number, purpose: string) {
  return `meta-connection:${storeId}:${purpose}`;
}

export function metaAssetTokenContext(storeId: number, externalId: string) {
  return `meta-asset:${storeId}:${externalId}`;
}

export function metaSystemUserTokenContext(storeId: number) {
  return `meta-whatsapp-system-user:${storeId}`;
}

export function metaWhatsAppBusinessTokenContext(storeId: number, phoneNumberId: string) {
  return `meta-whatsapp-business:${storeId}:${phoneNumberId}`;
}

export function metaPlatformSecretContext(field: "app-secret" | "webhook-verify-token") {
  return `meta-platform:${field}`;
}
