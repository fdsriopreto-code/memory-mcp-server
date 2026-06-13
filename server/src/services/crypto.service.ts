import crypto from "crypto";
import { env } from "../config/env.js";

const ALGO = "aes-256-gcm";

function keyBuf() {
  return Buffer.from(env.ENCRYPTION_KEY.trim().slice(0, 64), "hex");
}

export function encrypt(text: string): string {
  const iv  = crypto.randomBytes(16);
  const key = keyBuf();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decrypt(data: string): string {
  const [ivHex, tagHex, encHex] = data.split(":");
  const key = keyBuf();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(encHex, "hex")) + decipher.final("utf8");
}
