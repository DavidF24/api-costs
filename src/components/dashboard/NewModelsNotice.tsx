"use client";

import { useEffect, useState } from "react";
import type { UnpricedModel } from "@/lib/activity/unpriced";
import { formatCompact, getSourceLabel } from "@/lib/format";

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Lists models in the saved history that the price catalog does not cover yet, so a new
// model is visible the day it first appears rather than at the next weekly price check.
export function NewModelsNotice() {
  const [models, setModels] = useState<UnpricedModel[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/activity/unpriced")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setModels(d.models); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  if (!models || models.length === 0) return null;
  const awaiting = models.filter((m) => m.kind === "awaiting");
  const others = models.filter((m) => m.kind !== "awaiting");
  const line = (m: UnpricedModel) => `${m.model} (${getSourceLabel(m.source)}, first seen ${day(m.firstSeen)}, ${formatCompact(m.tokens)} tokens)`;

  return (
    <div className="rounded-lg border border-card-border bg-card px-4 py-3 text-xs space-y-1">
      {awaiting.length > 0 && <>
        <p className="font-medium text-sm">{awaiting.length === 1 ? "New model awaiting a verified price" : `${awaiting.length} new models awaiting verified prices`}</p>
        <ul className="list-disc pl-5 text-muted">{awaiting.map((m) => <li key={`${m.source}|${m.model}`} className="break-words">{line(m)}</li>)}</ul>
        <p className="text-muted">Their tokens are left out of the API-price estimates and subscription splits until the price check adds an official rate.</p>
      </>}
      {others.length > 0 && <p className="text-muted break-words">
        Not priced: {others.map((m) => `${m.model} (${m.kind === "internal" ? "internal label" : m.kind === "missing-rate" ? "no published rate for some token types" : "billed by another provider"})`).join(", ")}.
      </p>}
    </div>
  );
}
