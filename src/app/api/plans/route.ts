import { NextResponse } from "next/server";
import { refreshPlanUsage } from "@/lib/plans";

export async function GET() {
  return NextResponse.json(await refreshPlanUsage(), { headers: { "Cache-Control": "no-store" } });
}
