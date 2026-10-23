import { NextResponse } from "next/server";
import { getPlanUsage } from "@/lib/plans";

export async function GET() {
  return NextResponse.json(await getPlanUsage(), { headers: { "Cache-Control": "no-store" } });
}
