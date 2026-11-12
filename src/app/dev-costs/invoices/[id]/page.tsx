import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { sqlite } from "@/lib/db";
import { localKeyRequest } from "@/lib/api-keys/request";
import { readInvoice, type Invoice } from "@/lib/dev-costs/invoices";
import { NotFound, readProfile } from "@/lib/dev-costs/store";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoice", robots: { index: false } };

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

// A printable invoice or statement. Use the browser's Print, then "Save as PDF".
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const h = await headers();
  const host = h.get("host") ?? "";
  if (!localKeyRequest(new Request(`http://${host}/dev-costs`, { headers: h }))) notFound();
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  let inv: Invoice;
  try { inv = readInvoice(sqlite, n); } catch (err) { if (err instanceof NotFound) notFound(); throw err; }
  // A draft shows the current "from" details; an issued document the ones it was issued with.
  // (The bill-to block of a draft is refreshed from the client when it is issued.)
  const from = inv.from ?? readProfile(sqlite);
  const title = inv.kind === "invoice" ? "Invoice" : "Statement";
  const groups = [...new Set(inv.lines.map((l) => l.groupName))];
  const subtotal = (g: string) => inv.lines.filter((l) => l.groupName === g).reduce((s, l) => s + Math.round(l.amountUsd * 100), 0) / 100;

  return <div className="invoice-page min-h-full">
    <style>{`
      .invoice-page { background: #fff; color: #111; font-size: 14px; line-height: 1.45; }
      .invoice-page .sheet { max-width: 800px; margin: 0 auto; padding: 48px 40px; }
      .invoice-page table { width: 100%; border-collapse: collapse; }
      .invoice-page th { text-align: left; font-weight: 500; font-size: 12px; color: #555; border-bottom: 1px solid #ccc; padding: 6px 4px; }
      .invoice-page td { padding: 6px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
      .invoice-page .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .invoice-page .muted { color: #555; }
      .invoice-page .banner { border: 1px solid #c80; color: #840; padding: 8px 12px; margin-bottom: 24px; font-size: 13px; }
      @media print { .no-print { display: none !important; } .invoice-page .sheet { padding: 0; } @page { margin: 18mm; } }
    `}</style>
    <div className="sheet">
      <div className="no-print" style={{ display: "flex", gap: 12, marginBottom: 24 }}><PrintButton /></div>
      {inv.status === "draft" && <p className="banner">Draft: not issued. Figures may still change.</p>}
      {inv.status === "void" && <p className="banner">Void: this document was cancelled.</p>}
      {inv.kind === "statement" && <p className="banner">Statement for your records. Not sent to the client.</p>}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 24, flexWrap: "wrap", marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{from.businessName || "Your business name"}</div>
          {from.address && <div className="muted" style={{ whiteSpace: "pre-line" }}>{from.address}</div>}
          <div className="muted">{[from.email, from.phone].filter(Boolean).join(" · ")}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{title}</div>
          <div>{inv.number ?? "Draft"}</div>
          <div className="muted">{monthLabel(inv.month)}</div>
          {inv.issuedOn && <div className="muted">Issued {day(inv.issuedOn)}</div>}
          {inv.dueOn && inv.kind === "invoice" && <div className="muted">Due {day(inv.dueOn)}</div>}
        </div>
      </div>
      <div style={{ marginBottom: 32 }}>
        <div className="muted" style={{ fontSize: 12 }}>Bill to</div>
        <div style={{ fontWeight: 500 }}>{inv.billTo.name}</div>
        {inv.billTo.contact && <div>{inv.billTo.contact}</div>}
        {inv.billTo.address && <div style={{ whiteSpace: "pre-line" }}>{inv.billTo.address}</div>}
        {inv.billTo.email && <div className="muted">{inv.billTo.email}</div>}
      </div>
      <table>
        <thead><tr><th>Description</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
        {groups.map((g) => <tbody key={g}>
          <tr><td colSpan={4} style={{ fontWeight: 600, paddingTop: 16, borderBottom: "none" }}>{g || "Other"}</td></tr>
          {inv.lines.filter((l) => l.groupName === g).map((l) => <tr key={l.id}>
            <td>{l.description}</td>
            <td className="num">{l.quantity !== null ? l.quantity.toFixed(2) : ""}</td>
            <td className="num">{l.rateUsd !== null ? usd(l.rateUsd) : ""}</td>
            <td className="num">{usd(l.amountUsd)}</td>
          </tr>)}
          {groups.length > 1 && <tr><td colSpan={3} className="muted" style={{ textAlign: "right" }}>Subtotal</td><td className="num">{usd(subtotal(g))}</td></tr>}
        </tbody>)}
        <tfoot>
          <tr><td colSpan={3} style={{ textAlign: "right", fontWeight: 600, borderBottom: "none", paddingTop: 12 }}>Total</td><td className="num" style={{ fontWeight: 600, borderBottom: "none", paddingTop: 12 }}>{usd(inv.totalUsd)}</td></tr>
          {inv.paidUsd > 0 && <tr><td colSpan={3} style={{ textAlign: "right", borderBottom: "none" }}>Paid</td><td className="num" style={{ borderBottom: "none" }}>−{usd(inv.paidUsd)}</td></tr>}
          {inv.status === "issued" && inv.kind === "invoice" && <tr><td colSpan={3} style={{ textAlign: "right", fontWeight: 600, borderBottom: "none" }}>Balance due</td><td className="num" style={{ fontWeight: 600, borderBottom: "none" }}>{usd(inv.balanceUsd)}</td></tr>}
        </tfoot>
      </table>
      <div className="muted" style={{ marginTop: 32, fontSize: 12, display: "grid", gap: 8 }}>
        {inv.notes && <p style={{ whiteSpace: "pre-line", color: "#111", fontSize: 14 }}>{inv.notes}</p>}
        <p>Hours are time spent working on each repository, from screen activity. Subscription shares divide each AI tool’s monthly fee by each repository’s share of that tool’s usage, passed through at cost with no markup.</p>
        {inv.billTo.paymentTerms && inv.kind === "invoice" && <p>Terms: {inv.billTo.paymentTerms}</p>}
        {from.paymentInstructions && inv.kind === "invoice" && <p style={{ whiteSpace: "pre-line" }}>{from.paymentInstructions}</p>}
      </div>
    </div>
  </div>;
}
