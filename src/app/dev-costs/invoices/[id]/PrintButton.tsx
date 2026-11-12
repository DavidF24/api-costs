"use client";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} style={{ border: "1px solid #999", borderRadius: 8, padding: "6px 14px", background: "#fff", color: "#111", cursor: "pointer" }}>
    Print or save as PDF
  </button>;
}
