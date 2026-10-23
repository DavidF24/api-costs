import { sqlite } from "@/lib/db";
import { collectKeys } from "./collect";
import { saveKeyBatch, saveKeyStatus } from "./store";
import { KEY_PROVIDERS, type KeyProvider } from "./types";
const g = globalThis as unknown as { __keySync?: Map<string, Promise<void>> };
const pending = g.__keySync ??= new Map();
export function syncKeys(provider: string): Promise<void> {
  if (!KEY_PROVIDERS.includes(provider as KeyProvider)) return Promise.resolve();
  const active = pending.get(provider); if (active) return active;
  const job = collectKeys(provider as KeyProvider, {
    batch: (batch) => saveKeyBatch(sqlite, batch),
    status: (...args) => saveKeyStatus(sqlite, ...args),
  }).catch(() => {
    // Configuration and database failures must not echo credential-bearing objects.
    saveKeyStatus(sqlite, provider, "configuration", "inventory", false, "Key sync could not start. Check the local provider configuration.");
  }).finally(() => pending.delete(provider));
  pending.set(provider, job); return job;
}
export async function syncAllKeys() { await Promise.all(KEY_PROVIDERS.map(syncKeys)); }
