import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { botStorageKey, decryptBotAccess, encryptedBotAccess } from "./grok-bot-auth.ts";
import { cachedQuota, getCachedQuota, quotaBody, quotaPlan, quotaRequest, unavailable } from "./grok.ts";
import { parseBotUsage } from "./grok-wire.ts";
import type { PlanUsage } from "./parse.ts";

const NAME = "Grok Bot";
const LOGIN = "Open Grok Bot and sign in on this Mac to refresh its existing login.";
const globalKey = globalThis as typeof globalThis & { grokBotStorageKey?: { pending: Promise<Buffer | null>; retryAt: number } };

function encryptedLogin(): { encrypted: Buffer; fingerprint: string } | null {
  try {
    const path = join(homedir(), "Library", "Application Support", "Grok Bot", "sand-secrets.json");
    if (statSync(path).size > 1024 * 1024) return null;
    const contents = readFileSync(path, "utf8");
    if (Buffer.byteLength(contents) > 1024 * 1024) return null;
    const encrypted = encryptedBotAccess(JSON.parse(contents));
    return encrypted ? { encrypted, fingerprint: createHash("sha256").update(encrypted).digest("hex") } : null;
  } catch { return null; }
}

function storageKey(): Promise<Buffer | null> {
  if (globalKey.grokBotStorageKey && globalKey.grokBotStorageKey.retryAt > Date.now()) return globalKey.grokBotStorageKey.pending;
  const entry = { retryAt: Date.now() + 10 * 60000, pending: Promise.resolve<Buffer | null>(null) };
  entry.pending = (async () => {
    try {
      const { stdout } = await promisify(execFile)("/usr/bin/security", ["find-generic-password", "-s", "Grok Bot Safe Storage", "-a", "Grok Bot Key", "-w"], { encoding: "buffer", timeout: 20000, maxBuffer: 65536 });
      const password = stdout.subarray(0, stdout.at(-1) === 10 ? stdout.length - 1 : stdout.length);
      if (!password.length) return null;
      try { const key = botStorageKey(password); entry.retryAt = Infinity; return key; }
      finally { stdout.fill(0); }
    } catch { return null; }
  })();
  globalKey.grokBotStorageKey = entry;
  return entry.pending;
}

// Initial page rendering never reads Keychain or waits on a network request.
export function getCachedGrokBotUsage(): PlanUsage {
  const login = encryptedLogin();
  if (!login) return unavailable("grokbot", NAME, LOGIN);
  return getCachedQuota(`grokbot:${login.fingerprint}`) ?? unavailable("grokbot", NAME, "Refreshing Grok Bot usage…");
}

export function getGrokBotUsage(): Promise<PlanUsage> {
  const login = encryptedLogin();
  if (!login) return Promise.resolve(unavailable("grokbot", NAME, LOGIN));
  return cachedQuota(`grokbot:${login.fingerprint}`, async () => {
    const key = await storageKey();
    if (!key) return unavailable("grokbot", NAME, "Allow Grok Bot Safe Storage access in macOS Keychain. If denied, restart the dashboard to retry, or wait ten minutes.");
    const now = Date.now() / 1000;
    const token = decryptBotAccess(login.encrypted, key, now);
    if (!token) return unavailable("grokbot", NAME, LOGIN);
    try {
      const response = await quotaRequest("https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus", { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Connect-Protocol-Version": "1" }, "{}");
      const reading = parseBotUsage(JSON.parse((await quotaBody(response)).toString("utf8")), now);
      if (!reading) return unavailable("grokbot", NAME, "Grok Bot did not report a current weekly allowance. Open its usage screen to check your plan.");
      return quotaPlan("grokbot", NAME, reading, now, "Automatic weekly allowance from Grok Bot’s usage service, using the app’s existing login.");
    } catch { return unavailable("grokbot", NAME, "Couldn’t refresh Grok Bot usage. Check its login and connection; automatic retry runs in one minute."); }
  });
}
