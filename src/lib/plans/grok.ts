import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseGrokGRPC, parseGrokREST, type BillingReading } from "./grok-wire.ts";
import { windowLabel, type PlanUsage } from "./parse.ts";

export function quotaPlan(id: "grok" | "grokbot", name: string, r: BillingReading, now: number, note: string): PlanUsage {
  const at = new Date(now * 1000).toISOString();
  return { id, name, status: "ok", windows: [{ key: `${id}:${r.minutes}`, label: windowLabel(r.minutes), windowMinutes: r.minutes, usedPercent: r.used, resetsAt: r.end, updatedAt: at, reset: false }], updatedAt: at, staleAfterMinutes: 5, note };
}
export function unavailable(id: "grok" | "grokbot", name: string, message: string): PlanUsage {
  return { id, name, status: "missing", windows: [], updatedAt: null, message };
}

export async function quotaRequest(url: string, headers: Record<string, string>, body?: Buffer | string): Promise<Response> {
  const r = await fetch(url, { method: body === undefined ? "GET" : "POST", headers, body: body as BodyInit | undefined, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!r.ok) { await r.body?.cancel(); throw Error(r.status === 401 || r.status === 403 ? "sign-in expired" : "usage service unavailable"); }
  return r;
}
export async function quotaBody(r: Response): Promise<Buffer> {
  if (Number(r.headers.get("content-length")) > 1024 * 1024) { await r.body?.cancel(); throw Error("response too large"); }
  const reader = r.body?.getReader(); if (!reader) throw Error("empty response");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) throw Error("response too large"); chunks.push(value); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

type CacheEntry = { until: number; promise: Promise<PlanUsage> };
const globalCache = globalThis as typeof globalThis & { subscriptionReadings?: Map<string, CacheEntry> };
export function cachedQuota(key: string, load: () => Promise<PlanUsage>): Promise<PlanUsage> {
  const cache = globalCache.subscriptionReadings ??= new Map();
  const current = cache.get(key);
  if (current && current.until > Date.now()) return current.promise;
  const promise = load(); cache.set(key, { until: Date.now() + 60000, promise });
  return promise;
}

export function getGrokUsage(): Promise<PlanUsage> {
  let token: string, expires: number;
  try {
    const path = join(homedir(), ".grok", "auth.json");
    if (statSync(path).size > 1024 * 1024) throw Error();
    const auth = JSON.parse(readFileSync(path, "utf8"));
    const candidates = Object.entries(auth).filter(([key]) => key.startsWith("https://auth.x.ai::")).map(([, v]) => v as Record<string, unknown>).filter(v => v?.auth_mode === "oidc" && v.principal_type === "User" && typeof v.key === "string");
    if (candidates.length !== 1) throw Error();
    token = candidates[0].key as string; expires = Date.parse(String(candidates[0].expires_at)) / 1000;
    if (!Number.isFinite(expires) || expires <= Date.now() / 1000 + 30) throw Error();
  } catch { return Promise.resolve(unavailable("grok", "Grok subscription", "Sign in with the Grok CLI on this Mac to refresh its existing login. API billing keys do not supply subscription usage.")); }
  const fingerprint = createHash("sha256").update(token).digest("hex");
  return cachedQuota(`grok:${fingerprint}`, async () => {
    const now = Date.now() / 1000;
    try {
      const auth = { Authorization: `Bearer ${token}` };
      const rest = await quotaRequest("https://cli-chat-proxy.grok.com/v1/billing?format=credits", { ...auth, Accept: "application/json", "x-xai-token-auth": "xai-grok-cli" });
      let r = parseGrokREST(JSON.parse((await quotaBody(rest)).toString()), now);
      if (!r) {
        const rpc = await quotaRequest("https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig", { ...auth, Origin: "https://grok.com", Referer: "https://grok.com/?_s=usage", "Content-Type": "application/grpc-web+proto", "x-grpc-web": "1", "x-user-agent": "connect-es/2.1.1", "User-Agent": "AI-Usage-Local/1.0" }, Buffer.from([0, 0, 0, 0, 2, 8, 0]));
        const status = rpc.headers.get("grpc-status");
        if (status && status !== "0") throw Error("usage unavailable");
        r = parseGrokGRPC(await quotaBody(rpc), now);
      }
      if (!r) throw Error("usage unavailable");
      return quotaPlan("grok", "Grok subscription", r, now, "Automatic subscription allowance from Grok’s billing service, using the existing local Grok login.");
    } catch { return unavailable("grok", "Grok subscription", "Couldn’t refresh Grok subscription usage. Check the Grok login and connection; automatic retry runs in one minute."); }
  });
}
