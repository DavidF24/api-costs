import { NextResponse } from "next/server";
import { sqlite } from "@/lib/db";
import { PRICING_VERIFIED_ON } from "@/lib/activity/pricing";
import { readUnpricedModels } from "@/lib/activity/unpriced";

// Models in saved history that have no verified price. Aggregate counts only.
export async function GET() {
  return NextResponse.json({ verifiedOn: PRICING_VERIFIED_ON, models: readUnpricedModels(sqlite) });
}
