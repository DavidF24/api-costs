import { NextResponse } from "next/server";
import { sqlite } from "@/lib/db";
import { PRICING_VERIFIED_ON } from "@/lib/activity/pricing";
import { readUnpricedModels } from "@/lib/activity/unpriced";
import { localKeyRequest } from "@/lib/api-keys/request";

// Models in saved history that have no verified price. Aggregate counts only.
export async function GET(request: Request) {
  if (!localKeyRequest(request)) return NextResponse.json({ error: "Local requests only" }, { status: 403 });
  return NextResponse.json({ verifiedOn: PRICING_VERIFIED_ON, models: readUnpricedModels(sqlite) });
}
