import { createDecipheriv, createHash } from "node:crypto";

const ENCRYPTED_PREFIX = "enc:v1:";
const KEY_ENV = "CONFIG_ENCRYPTION_KEY";

function encryptionKey(configured = process.env[KEY_ENV]?.trim()): Buffer {
  if (!configured || configured.length < 32) {
    throw new Error(`${KEY_ENV} must be set to at least 32 characters.`);
  }
  return createHash("sha256").update(configured).digest();
}

export function decryptConfigValue(value: string): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value;
  const [ivEncoded, tagEncoded, ciphertextEncoded] = value.slice(ENCRYPTED_PREFIX.length).split(".");
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error("Invalid encrypted configuration value.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}