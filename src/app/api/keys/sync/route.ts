import { NextResponse } from "next/server";
import { localKeyRequest } from "@/lib/api-keys/request";
import { syncAllKeys } from "@/lib/api-keys/sync";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!localKeyRequest(request)) return NextResponse.json({ error: "Local requests only" }, { status: 403 });
  await syncAllKeys();
  return NextResponse.json({ ok: true });
}
