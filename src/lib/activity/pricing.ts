// Current standard, short-context USD list rates per million tokens. This is a
// what-would-it-cost-now comparison, not historical billing. Keep this reviewed
// snapshot in Git; see README's weekly pricing maintenance procedure.
export const PRICING_VERIFIED_ON = "2026-10-25";
export const PRICING_SOURCES = [
  { name: "Anthropic", url: "https://platform.claude.com/docs/en/about-claude/pricing" },
  { name: "OpenAI", url: "https://developers.openai.com/api/docs/pricing" },
  { name: "xAI", url: "https://docs.x.ai/developers/pricing" },
] as const;

export type UsageForCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
};

export type ModelPrice = {
  input: number;
  output: number;
  cacheRead: number;
  // Null means no verified rate. Positive usage in that category is unpriced,
  // never silently free. Codex only populates the short cache-write column.
  cacheWrite5m: number | null;
  cacheWrite1h: number | null;
};

function claude(input: number, output: number, cacheRead = input * 0.1): ModelPrice {
  return { input, output, cacheRead, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2 };
}
function openai(input: number, output: number, cacheRead: number, cacheWrite: number | null = null): ModelPrice {
  return { input, output, cacheRead, cacheWrite5m: cacheWrite, cacheWrite1h: null };
}
function grok(input: number, output: number, cacheRead: number): ModelPrice {
  return { input, output, cacheRead, cacheWrite5m: input, cacheWrite1h: input };
}

export const PRICES: Record<string, ModelPrice> = {
  // Anthropic: official pricing page above, including the documented cache
  // discounts for Fable/Mythos 5.1 and Opus/Sonnet 5.5. Haiku 5.5 uses its
  // <=100k prompt baseline. Long-context and speed premiums are excluded.
  "claude-fable-5-1": claude(10, 50, 0.25),
  "claude-mythos-5-1": claude(10, 50, 0.25),
  "claude-fable-5": claude(10, 50),
  "claude-mythos-5": claude(10, 50),
  "claude-opus-5-5": claude(4, 20, 0.2),
  "claude-opus-5": claude(5, 25),
  "claude-opus-4-8": claude(5, 25),
  "claude-opus-4-7": claude(5, 25),
  "claude-opus-4-6": claude(5, 25),
  "claude-opus-4-5": claude(5, 25),
  "claude-sonnet-5-5": claude(2, 10, 0.1),
  "claude-sonnet-5": claude(2, 10),
  "claude-sonnet-4-6": claude(3, 15),
  "claude-sonnet-4-5": claude(3, 15),
  "claude-haiku-5-5": claude(0.1, 0.5, 0.01),
  "claude-haiku-4-5": claude(1, 5),

  // OpenAI: Standard (not Flex/Batch/Fast) from the official pricing page.
  "gpt-6-astra": openai(10, 50, 1, 12.5),
  "gpt-6.1-sol": openai(2, 10, 0.1, 2.5),
  "gpt-6-luna": openai(0.1, 0.5, 0.01, 0.125),
  // Promotional price: official page guarantees at least through 2026-11-21.
  "gpt-5.6-sol": openai(4, 20, 0.4, 5),
  // Older model pages: https://developers.openai.com/api/docs/models/<model-id>
  // GPT-6 Sol documents cache writes. The other pages below only document
  // input / cached input / output, so their write rates remain unknown.
  "gpt-6-sol": openai(2, 10, 0.2, 2.5),
  "gpt-5.6-terra": openai(2, 12, 0.2),
  "gpt-5.6-luna": openai(0.2, 1.2, 0.02),
  "gpt-5.4": openai(2.5, 15, 0.25),
  "gpt-5.2": openai(1.75, 14, 0.175),
  "gpt-5.2-codex": openai(1.75, 14, 0.175),
  "gpt-5": openai(1.25, 10, 0.125),
  "gpt-5-mini": openai(0.25, 2, 0.025),

  // xAI: corresponding public model's Standard short-context baseline.
  // Per-turn logs cannot resolve per-request long-context / Fast premiums.
  "grok-4.7": grok(2, 6, 0.5),
  "grok-4.6": grok(2, 6, 0.5),
  "grok-4.5": grok(2, 6, 0.3),
  "grok-4.3": grok(1.25, 2.5, 0.2),
  "grok-build-0.1": grok(1, 2, 0.2),
  "grok-4.20-multi-agent-0309": grok(1.25, 2.5, 0.2),
  "grok-4.20-0309-reasoning": grok(1.25, 2.5, 0.2),
  "grok-4.20-0309-non-reasoning": grok(1.25, 2.5, 0.2),
  // codex-auto-review is an internal label, not a documented public model ID.
  // Unknown models stay unpriced until a matching official rate is verified.
};

export function normalizeModelId(model: string): string {
  let m = model.replace(/\[[^\]]*\]$/, "");
  m = m.replace(/-\d{8}$/, "");
  return m.replace(/^(grok-4\.[567])-build$/, "$1");
}

export function getModelPrice(model: string): ModelPrice | undefined {
  const id = normalizeModelId(model);
  return Object.hasOwn(PRICES, id) ? PRICES[id] : undefined;
}

export function estimateCost(model: string, usage: UsageForCost): number | null {
  const price = getModelPrice(model);
  const counts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite5m, usage.cacheWrite1h];
  if (!price || counts.some((v) => !Number.isFinite(v) || v < 0)) return null;
  if ((usage.cacheWrite5m > 0 && price.cacheWrite5m === null) ||
      (usage.cacheWrite1h > 0 && price.cacheWrite1h === null)) return null;
  const cost =
    (usage.input * price.input + usage.output * price.output +
      usage.cacheRead * price.cacheRead +
      usage.cacheWrite5m * (price.cacheWrite5m ?? 0) +
      usage.cacheWrite1h * (price.cacheWrite1h ?? 0)) / 1_000_000;
  return Number.isFinite(cost) ? cost : null;
}

// Reprice all retained local aggregates at current rates, including rows first
// indexed with NULL or outdated estimates. No source logs or DB writes required.
// Actual billed API rows are never repriced by this helper.
export function priceRecordedUsage(source: string, model: string, usage: UsageForCost, recorded: number | null): number | null {
  if (source === "grok-bot") return null;
  return ["claude-code", "codex", "grok"].includes(source) ? estimateCost(model, usage) : recorded;
}
