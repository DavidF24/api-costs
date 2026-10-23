import { createDecipheriv, pbkdf2Sync } from "node:crypto";

/** Only the active native Grok Bot account's encrypted access token is read. */
export function encryptedBotAccess(data: unknown): Buffer | null {
  try {
    if (!data || typeof data !== "object") return null;
    const store = (data as Record<string, unknown>)["cursor-accounts"];
    if (typeof store !== "string" || store.length > 1024 * 1024) return null;
    const accounts = JSON.parse(store);
    if (typeof accounts?.active !== "string" || !accounts.accounts || !Object.hasOwn(accounts.accounts, accounts.active)) return null;
    const encoded = accounts.accounts[accounts.active]?.["cursor-access-token"];
    if (typeof encoded !== "string" || encoded.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
    const encrypted = Buffer.from(encoded, "base64");
    if (encrypted.toString("base64") !== encoded || encrypted.subarray(0, 3).toString() !== "v10" || encrypted.length < 19 || (encrypted.length - 3) % 16 !== 0) return null;
    return encrypted;
  } catch { return null; }
}

/** Chromium's documented macOS Safe Storage format, with the app's own key. */
export function botStorageKey(password: Buffer): Buffer {
  return pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

export function decryptBotAccess(encrypted: Buffer, key: Buffer, now: number): string | null {
  try {
    if (key.length !== 16 || encrypted.subarray(0, 3).toString() !== "v10" || encrypted.length < 19 || encrypted.length > 24576 || (encrypted.length - 3) % 16 !== 0) return null;
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
    const token = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]).toString("utf8");
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    // The usage service validates the JWT. Locally reject expired/malformed logins.
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= now + 30) return null;
    return token;
  } catch { return null; }
}
