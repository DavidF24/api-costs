import type { ProviderAdapter, CostEntry } from "./types";
import { toEasternDate } from "../timezone";

// Parse OpenAI line_item strings like "gpt-4o, input" or "Image models"
function parseLineItem(lineItem: string): { model: string; direction: string; unitType: string } {
  // Common format: "model-name, input" or "model-name, output" or "model-name, cached input"
  const commaMatch = lineItem.match(/^(.+),\s*(cached input|input|output|input audio|output audio)$/i);
  if (commaMatch) {
    return {
      model: commaMatch[1].trim(),
      direction: commaMatch[2].toLowerCase().includes("input") ? "input" : "output",
      unitType: "tokens",
    };
  }

  // Category-level items like "Image models", "Audio models"
  if (/image/i.test(lineItem)) {
    return { model: lineItem, direction: "total", unitType: "images" };
  }
  if (/audio/i.test(lineItem)) {
    return { model: lineItem, direction: "total", unitType: "flat" };
  }

  // Fallback: store the raw string as the model name
  console.warn(`[openai] Unrecognized line_item format: "${lineItem}"`);
  return { model: lineItem, direction: "total", unitType: "unknown" };
}

type OpenAICostBucket = {
  start_time: number;
  end_time: number;
  start_time_iso?: string;
  results: Array<{
    amount: { value: number | string; currency: string };
    line_item: string | null;
    project_id: string | null;
  }>;
};

type OpenAICostResponse = {
  object: string;
  data: OpenAICostBucket[];
  has_more?: boolean;
  next_page?: string;
};

type OpenAIAccount = { organizationId?: string; adminKey: string };

export function accounts(): OpenAIAccount[] {
  const multiple = process.env.OPENAI_ADMIN_KEYS?.trim();
  if (!multiple) {
    const adminKey = process.env.OPENAI_ADMIN_KEY?.trim();
    return adminKey ? [{ adminKey }] : [];
  }

  const invalid = () => new Error(
    "OPENAI_ADMIN_KEYS must be a nonempty JSON array of { organizationId, adminKey }, with one unique key per organization"
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(multiple);
  } catch {
    throw invalid(); // JSON parser errors can echo part of the secret configuration.
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw invalid();
  const organizations = new Set<string>();
  const keys = new Set<string>();
  return parsed.map((value: unknown) => {
    if (!value || typeof value !== "object") throw invalid();
    const { organizationId, adminKey } = value as Record<string, unknown>;
    if (typeof organizationId !== "string" || !/^org[-_][A-Za-z0-9]+$/.test(organizationId)
      || typeof adminKey !== "string" || !adminKey.trim() || /[\r\n]/.test(adminKey)) throw invalid();
    const key = adminKey.trim();
    if (organizations.has(organizationId) || keys.has(key)) throw invalid();
    organizations.add(organizationId);
    keys.add(key);
    return { organizationId, adminKey: key };
  });
}

export function accountHeaders(account: OpenAIAccount): Record<string, string> {
  return {
    Authorization: `Bearer ${account.adminKey}`,
    ...(account.organizationId ? { "OpenAI-Organization": account.organizationId } : {}),
  };
}

export class OpenAIAdapter implements ProviderAdapter {
  provider = "openai";

  isConfigured(): boolean {
    return !!(process.env.OPENAI_ADMIN_KEYS?.trim() || process.env.OPENAI_ADMIN_KEY?.trim());
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const configured = accounts();
      if (!configured.length) return { ok: false, error: "OpenAI admin key not set" };
      for (const account of configured) {
        const res = await fetch(
          `https://api.openai.com/v1/organization/costs?start_time=${Math.floor(Date.now() / 1000) - 86400}&limit=1`,
          { headers: accountHeaders(account) }
        );
        if (!res.ok) {
          const text = await res.text();
          return { ok: false, error: `OpenAI ${account.organizationId ?? "organization"} HTTP ${res.status}: ${text.slice(0, 200)}` };
        }
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sync(since: Date): Promise<CostEntry[]> {
    const configured = accounts();
    if (!configured.length) throw new Error("OpenAI admin key not set");

    // The database key has no organization column. Sum matching daily line items
    // before the upsert so one organization's bill cannot overwrite another's.
    const totals = new Map<string, CostEntry>();
    const startTime = Math.floor(since.getTime() / 1000);
    const endTime = Math.floor(Date.now() / 1000);

    for (const account of configured) {
      let page: string | undefined;
      do {
        const params = new URLSearchParams({
          start_time: String(startTime),
          end_time: String(endTime),
          "group_by[]": "line_item",
          limit: "100",
        });
        if (page) params.set("page", page);
        const res = await fetch(
          `https://api.openai.com/v1/organization/costs?${params}`,
          { headers: accountHeaders(account) }
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`OpenAI ${account.organizationId ?? "organization"} API error ${res.status}: ${text.slice(0, 500)}`);
        }
        const data: OpenAICostResponse = await res.json();
        for (const bucket of data.data) {
          const date = toEasternDate(new Date(bucket.start_time * 1000));
          for (const result of bucket.results) {
            const costVal = Number(result.amount?.value ?? 0);
            if (!costVal) continue;
            const lineItem = result.line_item ?? "unknown";
            const { model, direction, unitType } = parseLineItem(lineItem);
            const id = JSON.stringify([date, model, direction, lineItem]);
            const existing = totals.get(id);
            if (existing) existing.costUsd += costVal;
            else totals.set(id, { provider: "openai", model, date, costUsd: costVal,
              unitType, direction, rawLineItem: lineItem });
          }
        }
        page = data.next_page;
      } while (page);
    }
    // A failure in any account rejects the whole sync; no partial totals are written.
    return [...totals.values()];
  }
}
