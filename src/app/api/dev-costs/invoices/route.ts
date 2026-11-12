import { NextResponse } from "next/server";
import { z } from "zod";
import { sqlite } from "@/lib/db";
import { localKeyRequest } from "@/lib/api-keys/request";
import { generateDraft, getMonthPreview } from "@/lib/dev-costs";
import { Conflict, NotFound, readProfile } from "@/lib/dev-costs/store";
import { toEasternDate } from "@/lib/timezone";
import { addLine, monthRange, addPayment, deleteLine, deletePayment, issueInvoice, readInvoice, saveNotes, updateLine, voidInvoice } from "@/lib/dev-costs/invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const id = z.number().int().positive();
const text = (max: number) => z.string().trim().max(max);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d);
const amount = z.number().min(-1_000_000).max(1_000_000);
const line = z.object({
  kind: z.enum(["time", "subscription", "other"]), groupName: text(120), description: text(300).min(1), repo: z.string().max(300).nullable(),
  quantity: z.number().min(0).max(10000).nullable(), unit: text(20), rateUsd: z.number().min(0).max(100000).nullable(), amountUsd: amount,
}).strict();

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), clientId: id, month }).strict(),
  z.object({ action: z.literal("addLine"), invoiceId: id, line }).strict(),
  z.object({ action: z.literal("updateLine"), invoiceId: id, lineId: id, line }).strict(),
  z.object({ action: z.literal("deleteLine"), invoiceId: id, lineId: id }).strict(),
  z.object({ action: z.literal("saveNotes"), invoiceId: id, notes: text(2000) }).strict(),
  z.object({ action: z.literal("issue"), invoiceId: id, issuedOn: date }).strict(),
  z.object({ action: z.literal("void"), invoiceId: id }).strict(),
  z.object({ action: z.literal("addPayment"), invoiceId: id, paidOn: date, amountUsd: z.number().positive().max(1_000_000), method: text(60), note: text(300) }).strict(),
  z.object({ action: z.literal("deletePayment"), invoiceId: id, paymentId: id }).strict(),
]);

function fail(err: unknown) {
  if (err instanceof NotFound) return NextResponse.json({ error: err.message }, { status: 404 });
  if (err instanceof Conflict) return NextResponse.json({ error: err.message }, { status: 409 });
  throw err;
}

// GET ?month=YYYY-MM: what each client's document for that month would hold.
// GET ?id=N: one saved invoice or statement with its lines and payments.
export async function GET(request: Request) {
  if (!localKeyRequest(request)) return NextResponse.json({ error: "Local requests only" }, { status: 403 });
  const url = new URL(request.url);
  const m = url.searchParams.get("month");
  const i = url.searchParams.get("id");
  try {
    if (m !== null) {
      if (!month.safeParse(m).success) return NextResponse.json({ error: "Month must be YYYY-MM" }, { status: 400 });
      return NextResponse.json(getMonthPreview(m), { headers: noStore });
    }
    const n = Number(i);
    if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "Give a month or an invoice id" }, { status: 400 });
    return NextResponse.json(readInvoice(sqlite, n), { headers: noStore });
  } catch (err) { return fail(err); }
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
    let invoiceId: number;
    switch (a.action) {
      case "generate": invoiceId = generateDraft(a.clientId, a.month); break;
      case "addLine": addLine(sqlite, a.invoiceId, a.line); invoiceId = a.invoiceId; break;
      case "updateLine": requireLine(a.invoiceId, a.lineId); updateLine(sqlite, a.lineId, a.line); invoiceId = a.invoiceId; break;
      case "deleteLine": requireLine(a.invoiceId, a.lineId); deleteLine(sqlite, a.lineId); invoiceId = a.invoiceId; break;
      case "saveNotes": saveNotes(sqlite, a.invoiceId, a.notes); invoiceId = a.invoiceId; break;
      case "issue": {
        const inv = readInvoice(sqlite, a.invoiceId);
        if (toEasternDate(new Date()) < monthRange(inv.month)[1]) throw new Conflict("This month has not ended yet");
        if (a.issuedOn < monthRange(inv.month)[1]) throw new Conflict("The issue date must be after the month it bills");
        issueInvoice(sqlite, a.invoiceId, a.issuedOn, readProfile(sqlite)); invoiceId = a.invoiceId; break;
      }
      case "void": {
        const before = readInvoice(sqlite, a.invoiceId);
        voidInvoice(sqlite, a.invoiceId);
        // A deleted draft has nothing left to show.
        if (before.status === "draft") return NextResponse.json({ deleted: true }, { headers: noStore });
        invoiceId = a.invoiceId; break;
      }
      case "addPayment": addPayment(sqlite, a.invoiceId, { paidOn: a.paidOn, amountUsd: a.amountUsd, method: a.method, note: a.note }); invoiceId = a.invoiceId; break;
      case "deletePayment": requirePayment(a.invoiceId, a.paymentId); deletePayment(sqlite, a.paymentId); invoiceId = a.invoiceId; break;
    }
    return NextResponse.json(readInvoice(sqlite, invoiceId), { headers: noStore });
  } catch (err) { return fail(err); }
}

function requireLine(invoiceId: number, lineId: number) {
  if (!sqlite.prepare(`SELECT 1 FROM dc_invoice_lines WHERE id=? AND invoice_id=?`).get(lineId, invoiceId)) throw new NotFound("Line not found");
}
function requirePayment(invoiceId: number, paymentId: number) {
  if (!sqlite.prepare(`SELECT 1 FROM dc_payments WHERE id=? AND invoice_id=?`).get(paymentId, invoiceId)) throw new NotFound("Payment not found");
}

