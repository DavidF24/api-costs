import { refreshPlanUsage } from "@/lib/plans";
import { sqlite, databasePath } from "@/lib/db";
import { backupDatabase } from "@/lib/db/backup";

type RetentionState = { started: boolean; timer?: NodeJS.Timeout; current?: Promise<void> };
const g = globalThis as unknown as { __retention?: RetentionState };
const state = (g.__retention ??= { started: false });

// Quota observations continue without an open browser. Local source apps must still
// provide readings; missing periods are not backfilled with invented percentages.
export function startRetention() {
  const raw = process.env.HISTORY_CAPTURE_MINUTES;
  const minutes = raw === undefined || raw === "" ? 5 : Number(raw);
  if (state.started || !Number.isFinite(minutes) || minutes <= 0) return;
  state.started = true;
  const schedule = (delay: number) => {
    state.timer = setTimeout(async () => {
      await runRetentionTick();
      schedule(minutes * 60_000);
    }, delay);
    state.timer.unref();
  };
  schedule(30_000);
}

export function runRetentionTick(): Promise<void> {
  if (state.current) return state.current;
  state.current = (async () => {
    try {
      await refreshPlanUsage();
    } catch {
      console.error("[retention] subscription snapshot failed; prior history retained");
    }
    try {
      await backupDatabase(sqlite, databasePath);
    } catch {
      console.error("[retention] daily database backup failed; prior backups retained");
    }
  })().finally(() => { state.current = undefined; });
  return state.current;
}
