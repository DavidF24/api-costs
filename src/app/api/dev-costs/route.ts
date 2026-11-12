import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlite } from "@/lib/db";
import { localKeyRequest } from "@/lib/api-keys/request";
import { getDevCosts } from "@/lib/dev-costs";
import { Conflict, deleteClient, deleteTerm, NotFound, saveClient, saveProfile, saveRepoLink, saveTerm } from "@/lib/dev-costs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const text = (max: number) => z.string().trim().max(max);
const id = z.number().int().positive();
const money = z.number().min(0).max(100000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d);

const action = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("saveClient"), id: id.optional(), name: text(120).min(1), contact: text(120), email: text(200),
    address: text(500), paymentTerms: text(60), internal: z.boolean(), sendInvoices: z.boolean(), notes: text(2000),
    hourlyRateUsd: money, idleCutoffMin: z.number().int().min(0).max(240),
  }).strict(),
  z.object({ action: z.literal("deleteClient"), id }).strict(),
  z.object({
    action: z.literal("saveRepoLink"), repo: z.string().min(1).max(300).regex(/^[^\0]+$/), clientId: id.nullable(),
    displayName: text(120), projectName: text(120), hourlyRateUsd: money.nullable(),
  }).strict(),
  z.object({
    action: z.literal("saveProfile"), businessName: text(120), address: text(500), email: text(200), phone: text(60), paymentInstructions: text(1000),
  }).strict(),
  z.object({
    action: z.literal("saveTerm"), id: id.optional(), subscription: z.enum(["claude", "codex", "grok"]), planName: text(80),
    feeUsd: z.number().min(0).max(100000), renewalDay: z.number().int().min(1).max(31), startsOn: date,
  }).strict(),
  z.object({ action: z.literal("deleteTerm"), id }).strict(),
]);

export async function GET(request: Request) {
  if (!localKeyRequest(request)) return NextResponse.json({ error: "Local requests only" }, { status: 403 });
  return NextResponse.json(getDevCosts(), { headers: noStore });
}

export async function POST(request: Request) {
  if (!localKeyRequest(request)) return NextResponse.json({ error: "Local requests only" }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  const body = await request.text();
  if (body.length > 20000) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let parsed;
  try { parsed = action.safeParse(JSON.parse(body)); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const a = parsed.data;
  try {
    switch (a.action) {
      case "saveClient": saveClient(sqlite, a); break;
      case "deleteClient": deleteClient(sqlite, a.id); break;
      case "saveRepoLink": saveRepoLink(sqlite, a); break;
      case "saveProfile": saveProfile(sqlite, { businessName: a.businessName, address: a.address, email: a.email, phone: a.phone, paymentInstructions: a.paymentInstructions }); break;
      case "saveTerm": saveTerm(sqlite, a); break;
      case "deleteTerm": deleteTerm(sqlite, a.id); break;
    }
  } catch (err) {
    if (err instanceof NotFound) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof Conflict) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof Error && /UNIQUE constraint/.test(err.message)) return NextResponse.json({ error: "That name or start date is already used" }, { status: 409 });
    throw err;
  }
  return NextResponse.json(getDevCosts(), { headers: noStore });
}
