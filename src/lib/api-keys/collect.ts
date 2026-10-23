import { accounts, accountHeaders } from "../providers/openai.ts";
import { dateValue, identifierHint, keyIdentifier, maskedHint, safeText, type KeyBatch, type KeyMetadata, type KeyProvider, type KeyUsage } from "./types.ts";

type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const array = (v: unknown): Obj[] => { if (!Array.isArray(v)) throw new Error("Unexpected provider response"); return v.map(object); };
const number = (v: unknown): number => { const n = Number(v ?? 0); if (!Number.isFinite(n) || n < 0) throw new Error("Invalid provider usage"); return n; };
const utcDate = (v: unknown): string => { const date = dateValue(v); if (!date) throw new Error("Invalid provider date"); return date.slice(0, 10); };
export class KeyApiError extends Error { status: number; constructor(status: number) { super(`HTTP ${status}`); this.status = status; } }
export type KeySink = { batch: (batch: KeyBatch) => void; status: (provider: KeyProvider, account: string, phase: string, ok: boolean, message: string) => void };

// All requests are read-only GETs. Raw JSON and authentication headers never leave this module.
export async function collectKeys(provider: KeyProvider, sink: KeySink, now = new Date(), fetcher: typeof fetch = fetch) {
  const deadline = Date.now() + 120_000;
  async function get(url: string, headers: Record<string, string>): Promise<Obj> {
    if (Date.now() >= deadline) throw new Error("Key sync timed out");
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(Math.min(30_000, deadline - Date.now())), redirect: "error", cache: "no-store" });
    if (!response.ok) throw new KeyApiError(response.status);
    return object(await response.json());
  }
  async function phase(account: string, kind: KeyBatch["phase"], run: () => Promise<Omit<KeyBatch, "provider" | "account" | "phase">>, description: string) {
    try {
      const out = await run();
      sink.batch({ provider, account, phase: kind, ...out });
      sink.status(provider, account, kind, true, description);
      return out;
    } catch (error) {
      const message = error instanceof KeyApiError ? error.status === 403 ?
        (kind === "inventory" ? "Key inventory needs additional read permission (HTTP 403). Existing billing access is unchanged." : "Key usage permission denied (HTTP 403).") :
        `Provider returned HTTP ${error.status}. Saved records are retained.` : "Could not refresh this source. Saved records are retained.";
      sink.status(provider, account, kind, false, message);
      return null;
    }
  }
  function metadata(row: Obj, idField: string, hintField: string, hash = false): KeyMetadata {
    const keyId = keyIdentifier(row[idField]);
    const hint = maskedHint(row[hintField]);
    return { keyId, name: safeText(row.name), hint: hint ?? identifierHint(keyId), hintKind: hint ? "key" : hash ? "hash" : "id",
      status: safeText(row.status) || (row.disabled === true ? "disabled" : "active"), project: safeText(row.workspace_id ?? row.project_id),
      createdAt: dateValue(row.created_at ?? row.createTime), lastUsedAt: dateValue(row.last_used_at) };
  }
  // Reject repeating cursors rather than saving a truncated or duplicated inventory.
  function cursor(value: unknown, seen: Set<string>): string | undefined {
    if (value == null || value === "") return;
    if (typeof value !== "string" || seen.has(value) || seen.size >= 1000) throw new Error("Invalid provider pagination");
    seen.add(value); return value;
  }
  const start = new Date(now); start.setUTCDate(start.getUTCDate() - (provider === "openai" ? 90 : 30)); start.setUTCHours(0, 0, 0, 0);
  const end = now.toISOString();

  if (provider === "openai") {
    for (const account of accounts()) {
      const accountId = account.organizationId ?? "default";
      const headers = accountHeaders(account);
      await phase(accountId, "inventory", async () => {
        const keys: KeyMetadata[] = [];
        const projects: string[] = [];
        let after: string | undefined; const seen = new Set<string>();
        do {
          const p = new URLSearchParams({ limit: "100", include_archived: "true" }); if (after) p.set("after", after);
          const result = await get(`https://api.openai.com/v1/organization/projects?${p}`, headers);
          projects.push(...array(result.data).map((r) => keyIdentifier(r.id)));
          after = result.has_more ? cursor(result.last_id, seen) : undefined;
          if (result.has_more && !after) throw new Error("Missing projects cursor");
        } while (after);
        for (const project of projects) {
          let page: string | undefined; const visited = new Set<string>();
          do {
            const p = new URLSearchParams({ limit: "100" }); if (page) p.set("after", page);
            const result = await get(`https://api.openai.com/v1/organization/projects/${encodeURIComponent(project)}/api_keys?${p}`, headers);
            keys.push(...array(result.data).map((r) => ({ ...metadata(r, "id", "redacted_value"), project })));
            page = result.has_more ? cursor(result.last_id, visited) : undefined;
            if (result.has_more && !page) throw new Error("Missing keys cursor");
          } while (page);
        }
        return { keys };
      }, "Project API keys; provider names and redacted identifiers.");
      await phase(accountId, "usage", async () => {
        const usage: KeyUsage[] = []; const dates: string[] = []; let page: string | undefined; const seen = new Set<string>();
        do {
          const p = new URLSearchParams({ start_time: String(start.getTime() / 1000), end_time: String(Math.floor(now.getTime() / 1000)), bucket_width: "1d", limit: "31" });
          p.append("group_by[]", "api_key_id"); p.append("group_by[]", "model"); if (page) p.set("page", page);
          const result = await get(`https://api.openai.com/v1/organization/usage/completions?${p}`, headers);
          for (const bucket of array(result.data)) {
            const date = utcDate(bucket.start_time); dates.push(date);
            for (const row of array(bucket.results)) {
              if (!row.api_key_id) continue; // Aggregate/unattributed rows cannot be assigned to an individual key.
              usage.push({ keyId: keyIdentifier(row.api_key_id), date, model: safeText(row.model) || "unknown",
                input: number(row.input_tokens), output: number(row.output_tokens), requests: number(row.num_model_requests), cost: null });
            }
          }
          page = cursor(result.next_page, seen);
          if (result.has_more && !page) throw new Error("Missing usage cursor");
        } while (page);
        return { usage: aggregateUsage(usage), dates };
      }, "Text generation token counts by key ID. Billed cost is not available by key.");
    }
  } else if (provider === "anthropic" && process.env.ANTHROPIC_ADMIN_KEY) {
    const headers = { "x-api-key": process.env.ANTHROPIC_ADMIN_KEY, "anthropic-version": "2023-06-01" };
    const account = "organization";
    await phase(account, "inventory", async () => {
      const keys: KeyMetadata[] = []; let after: string | undefined; const seen = new Set<string>();
      do {
        const p = new URLSearchParams({ limit: "100" }); if (after) p.set("after_id", after);
        const result = await get(`https://api.anthropic.com/v1/organizations/api_keys?${p}`, headers);
        keys.push(...array(result.data).map((r) => metadata(r, "id", "partial_key_hint")));
        after = result.has_more ? cursor(result.last_id, seen) : undefined;
        if (result.has_more && !after) throw new Error("Missing keys cursor");
      } while (after);
      return { keys };
    }, "Organization API keys; provider names and redacted identifiers.");
    await phase(account, "usage", async () => {
      const usage: KeyUsage[] = []; const dates: string[] = []; let page: string | undefined; const seen = new Set<string>();
      do {
        const p = new URLSearchParams({ starting_at: start.toISOString(), ending_at: end, bucket_width: "1d", limit: "31" });
        p.append("group_by[]", "api_key_id"); p.append("group_by[]", "model"); if (page) p.set("page", page);
        const result = await get(`https://api.anthropic.com/v1/organizations/usage_report/messages?${p}`, headers);
        for (const bucket of array(result.data)) {
          const date = utcDate(bucket.starting_at); dates.push(date);
          for (const row of array(bucket.results)) {
            if (!row.api_key_id) continue;
            const cache = object(row.cache_creation);
            usage.push({ keyId: keyIdentifier(row.api_key_id), date, model: safeText(row.model) || "unknown",
              input: number(row.uncached_input_tokens) + number(row.cache_read_input_tokens) + number(cache.ephemeral_5m_input_tokens) + number(cache.ephemeral_1h_input_tokens),
              output: number(row.output_tokens), requests: null, cost: null });
          }
        }
        page = cursor(result.next_page, seen);
        if (result.has_more && !page) throw new Error("Missing usage cursor");
      } while (page);
      return { usage: aggregateUsage(usage), dates };
    }, "Messages tokens, including cached input. Billed cost and request counts are not available here.");
  } else if (provider === "openrouter" && process.env.OPENROUTER_MGMT_KEY) {
    const headers = { Authorization: `Bearer ${process.env.OPENROUTER_MGMT_KEY}` }; const account = "default workspace";
    const inventory = await phase(account, "inventory", async () => {
      const keys: KeyMetadata[] = []; let offset = 0;
      for (let pages = 0; pages < 1000; pages++) {
        const p = new URLSearchParams({ include_disabled: "true", include_expired: "true", offset: String(offset) });
        const rows = array((await get(`https://openrouter.ai/api/v1/keys?${p}`, headers)).data);
        keys.push(...rows.map((r) => metadata(r, "hash", "label", true)));
        if (rows.length < 100) return { keys };
        offset += rows.length;
      }
      throw new Error("Too many keys");
    }, "Default workspace keys. Hash identifiers are shown when a redacted key is unavailable.");
    if (inventory?.keys) await phase(account, "usage", async () => {
      const usage: KeyUsage[] = []; const today = now.toISOString().slice(0, 10);
      const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i - 1)).toISOString().slice(0, 10));
      for (const key of inventory.keys!) {
        const p = new URLSearchParams({ api_key_hash: key.keyId });
        const result = await get(`https://openrouter.ai/api/v1/activity?${p}`, headers);
        for (const row of array(result.data)) {
          const date = utcDate(row.date); if (!dates.includes(date) || date >= today) continue;
          usage.push({ keyId: key.keyId, date, model: safeText(row.model) || "unknown", input: number(row.prompt_tokens), output: number(row.completion_tokens), requests: number(row.requests), cost: number(row.usage) });
        }
      }
      return { usage: aggregateUsage(usage), dates, coverageKeyIds: inventory.keys!.map((key) => key.keyId) };
    }, "Reported OpenRouter cost and tokens for the last 30 completed UTC days. External BYOK charges excluded.");
  } else if (provider === "xai" && process.env.XAI_MANAGEMENT_KEY && process.env.XAI_TEAM_ID) {
    const account = safeText(process.env.XAI_TEAM_ID); const headers = { Authorization: `Bearer ${process.env.XAI_MANAGEMENT_KEY}` };
    await phase(account, "inventory", async () => {
      const keys: KeyMetadata[] = []; let page: string | undefined; const seen = new Set<string>();
      do {
        const p = new URLSearchParams({ pageSize: "100" }); if (page) p.set("paginationToken", page);
        const result = await get(`https://management-api.x.ai/auth/teams/${encodeURIComponent(account)}/api-keys?${p}`, headers);
        keys.push(...array(result.apiKeys).map((r) => metadata(r, "apiKeyId", "redactedApiKey")));
        page = cursor(result.paginationToken, seen);
      } while (page);
      return { keys };
    }, "Team API key metadata. Per-key usage is not integrated for xAI.");
  }
}
export function aggregateUsage(rows: KeyUsage[]): KeyUsage[] {
  const grouped = new Map<string, KeyUsage>();
  for (const row of rows) {
    const id = JSON.stringify([row.keyId, row.date, row.model]); const existing = grouped.get(id);
    if (!existing) grouped.set(id, { ...row });
    else { existing.input += row.input; existing.output += row.output; existing.requests = existing.requests === null || row.requests === null ? null : existing.requests + row.requests; existing.cost = existing.cost === null || row.cost === null ? null : existing.cost + row.cost; }
  }
  return [...grouped.values()];
}
