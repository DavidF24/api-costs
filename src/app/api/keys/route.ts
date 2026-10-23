import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlite } from "@/lib/db";
import { annotateKey, readKeys } from "@/lib/api-keys/store";
import { localKeyRequest, validKeyRange } from "@/lib/api-keys/request";
import { safeText } from "@/lib/api-keys/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!localKeyRequest(request)) return NextResponse.json({ error: "Local requests only" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const start = params.get("start") ?? ""; const end = params.get("end") ?? "";
  if (!validKeyRange(start, end)) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  return NextResponse.json(readKeys(sqlite, start, end), { headers: { "Cache-Control": "no-store" } });
}
const annotation = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), alias: z.string().trim().max(120), usedIn: z.string().trim().max(240), note: z.string().trim().max(2000) }).strict();
export async function PATCH(request: Request) {
  if (!localKeyRequest(request)) return NextResponse.json({ error: "Local requests only" }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  const text = await request.text();
  if (text.length > 12000) return NextResponse.json({ error: "Annotation too large" }, { status: 413 });
  let body; try { body = annotation.safeParse(JSON.parse(text)); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.success) return NextResponse.json({ error: "Invalid annotation" }, { status: 400 });
  const { id, alias, usedIn, note } = body.data;
  if (!annotateKey(sqlite, id, safeText(alias, 120), safeText(usedIn, 240), safeText(note, 2000))) return NextResponse.json({ error: "Key not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
