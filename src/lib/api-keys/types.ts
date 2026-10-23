export const KEY_PROVIDERS = ["openai", "anthropic", "openrouter", "xai"] as const;
export type KeyProvider = typeof KEY_PROVIDERS[number];
export type KeyMetadata = {
  keyId: string; name: string; hint: string; hintKind: "key" | "id" | "hash";
  status: string; project: string; createdAt: string | null; lastUsedAt: string | null;
};
export type KeyUsage = { keyId: string; date: string; model: string; input: number; output: number; requests: number | null; cost: number | null };
export type KeyBatch = { provider: KeyProvider; account: string; phase: "inventory" | "usage"; keys?: KeyMetadata[]; usage?: KeyUsage[]; dates?: string[]; coverageKeyIds?: string[] };
export type KeyStatus = { provider: string; account: string; phase: string; ok: number; message: string; attemptedAt: string; succeededAt: string | null };
export type KeyRecord = KeyMetadata & { id: string; provider: string; account: string; alias: string; usedIn: string; note: string; seenAt: string; input: number; output: number; requests: number | null; cost: number | null; days: number };
export type KeyView = { keys: KeyRecord[]; statuses: KeyStatus[]; daily: (KeyUsage & { id: string })[] };

// Accept provider-redacted hints only. An unexpected unredacted value is discarded.
export function maskedHint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split(/\.{3,}|…+|\*{3,}|•{3,}/);
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]{2,}$/.test(parts[0]) || !/^[A-Za-z0-9_-]{2,}$/.test(parts[1])) return null;
  return `${parts[0].slice(0, 8)}••••••${parts[1].slice(-8)}`;
}
export function identifierHint(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}••••••${id.slice(-8)}` : `${id.slice(0, 4)}••••••${id.slice(-4)}`;
}
export function safeText(value: unknown, max = 200): string {
  return typeof value === "string" ? value.replace(/(?:sk-|xai-)[A-Za-z0-9_-]{20,}/g, "[credential omitted]").replace(/[\u0000-\u001f]/g, " ").slice(0, max) : "";
}
export function keyIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value) || /^(sk-|xai-)/.test(value)) throw new Error("Provider returned an invalid key identifier");
  return value;
}
export function dateValue(value: unknown): string | null {
  const millis = typeof value === "number" ? value * 1000 : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}
