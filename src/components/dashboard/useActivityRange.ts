"use client";

import { useEffect, useState } from "react";
import type { ActivityResult } from "@/lib/activity/queries";
import { ACTIVITY_DEFAULT_DAYS } from "@/lib/format";
import { shiftDate } from "@/lib/timezone";

export function useActivityRange(initial: ActivityResult, year: ActivityResult, today: string, serverNow: number) {
  const [days, setDays] = useState(ACTIVITY_DEFAULT_DAYS);
  const seed = () => ({ [ACTIVITY_DEFAULT_DAYS]: initial, 365: year }) as Record<number, ActivityResult | "error">;
  const [byRange, setByRange] = useState(seed);
  const [stamp, setStamp] = useState(serverNow);
  if (stamp !== serverNow) {
    setStamp(serverNow);
    setByRange(seed());
  }
  const have = days in byRange;
  useEffect(() => {
    if (have) return;
    let cancelled = false;
    fetch(`/api/activity?start=${shiftDate(today, -(days - 1))}&end=${shiftDate(today, 1)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ActivityResult>;
      })
      .then((data) => !cancelled && setByRange((m) => ({ ...m, [days]: data })))
      .catch(() => !cancelled && setByRange((m) => ({ ...m, [days]: "error" })));
    return () => { cancelled = true; };
  }, [have, days, today]);
  const state = byRange[days];
  return { days, setDays, state, data: state && state !== "error" ? state : null };
}
