import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { windowTrend, type PlanUsage } from "./parse";
import { sqlite } from "@/lib/db";
import { archivePlanUsage, quotaHistoryJsonl } from "@/lib/db/quota-history";

// Optional legacy ai-quota history supplements the app-owned SQLite archive.
const HISTORY_PATH = join(homedir(), ".local", "state", "ai-usage", "history.jsonl");
const WEEK = 10080;

export function withWeeklyTrends(plans: PlanUsage[]): PlanUsage[] {
  let text = "";
  try {
    text = readFileSync(HISTORY_PATH, "utf8");
  } catch {
    // not installed
  }
  try {
    archivePlanUsage(sqlite, plans);
    text += "\n" + quotaHistoryJsonl(sqlite);
  } catch {
    // A storage failure must not turn a valid live reading into unavailable usage.
    console.error("[retention] quota archive failed; prior history retained");
  }
  return plans.map((plan) => ({
    ...plan,
    windows: plan.windows.map((w) =>
      w.windowMinutes === WEEK ? { ...w, trend: windowTrend(text, plan.id, w) } : w
    ),
  }));
}
