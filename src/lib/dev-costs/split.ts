// Subscription billing periods and the usage-share split of each period's fee.
// Pure: no fs, db or path aliases, so tests load it directly with `node --test`.

export const SUBSCRIPTIONS = [
  { id: "claude", label: "Claude", sources: ["claude-code"], tool: "Claude Code" },
  { id: "codex", label: "ChatGPT", sources: ["codex"], tool: "Codex" },
  { id: "grok", label: "Grok", sources: ["grok"], tool: "Grok" },
] as const;
export type SubscriptionId = (typeof SUBSCRIPTIONS)[number]["id"];

export type Term = {
  id: number;
  subscription: SubscriptionId;
  planName: string;
  feeUsd: number;
  renewalDay: number; // 1–31; short months renew on their last day
  startsOn: string; // YYYY-MM-DD, the first renewal date at this fee
};

export type Period = {
  subscription: SubscriptionId;
  termId: number;
  planName: string;
  feeUsd: number;
  start: string; // inclusive
  end: string; // exclusive: the next renewal date
  open: boolean; // today is inside the period, so the split is still a running estimate
  prorated: boolean; // cut short by the next fee taking effect; the fee covers only its days
};

const pad = (n: number) => String(n).padStart(2, "0");
const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

// The renewal date `months` months after the cycle that starts in (year, month).
export function renewalDate(year: number, month: number, day: number, months: number): string {
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(day, daysIn(y, m)))}`;
}

// Periods for every term that has started by `today`, newest first. A term runs until the
// next term for the same subscription starts, so a fee change takes effect on its own date
// and earlier periods keep the price that was actually paid.
export function billingPeriods(terms: Term[], today: string, limit = 12): Period[] {
  const out: Period[] = [];
  for (const sub of SUBSCRIPTIONS) {
    const mine: Period[] = [];
    const own = terms.filter((t) => t.subscription === sub.id).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    own.forEach((term, i) => {
      const stop = own[i + 1]?.startsOn ?? null;
      const [y, m] = term.startsOn.split("-").map(Number);
      let start = term.startsOn;
      for (let n = 0; start <= today && (!stop || start < stop) && n < 400; n++) {
        const full = renewalDate(y, m, term.renewalDay, n);
        if (full <= start) continue; // the renewal day this month is not after the start
        const end = stop && full > stop ? stop : full;
        // A plan change part way through a cycle: charge the old fee for the days it covered.
        const feeUsd = end === full ? term.feeUsd : Math.round((term.feeUsd * days(start, end)) / days(start, full) * 100) / 100;
        mine.push({ subscription: sub.id, termId: term.id, planName: term.planName, feeUsd, start, end, open: today < end, prorated: end !== full });
        start = end;
      }
    });
    out.push(...mine.sort((a, b) => b.start.localeCompare(a.start)).slice(0, limit));
  }
  return out;
}

export type UsageShare = { key: string; apiEquivalentUsd: number };
export type SplitLine = UsageShare & { share: number; chargeUsd: number };

// Splits the whole fee by each key's share of the period's API-equivalent value, in cents
// that add up exactly to the fee (largest remainder). With no priced usage the whole fee
// goes to `emptyKey`, so it stays visible rather than disappearing.
export function splitFee(feeUsd: number, usage: UsageShare[], emptyKey: string): SplitLine[] {
  const rows = usage.filter((u) => u.apiEquivalentUsd > 0);
  const total = rows.reduce((s, u) => s + u.apiEquivalentUsd, 0);
  const cents = Math.round(feeUsd * 100);
  if (total <= 0) return [{ key: emptyKey, apiEquivalentUsd: 0, share: 1, chargeUsd: cents / 100 }];
  const exact = rows.map((u) => (u.apiEquivalentUsd / total) * cents);
  const floors = exact.map(Math.floor);
  let left = cents - floors.reduce((s, n) => s + n, 0);
  const order = exact.map((v, i) => ({ i, r: v - floors[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]++;
    left--;
  }
  return rows
    .map((u, i) => ({ ...u, share: u.apiEquivalentUsd / total, chargeUsd: floors[i] / 100 }))
    .sort((a, b) => b.apiEquivalentUsd - a.apiEquivalentUsd);
}
