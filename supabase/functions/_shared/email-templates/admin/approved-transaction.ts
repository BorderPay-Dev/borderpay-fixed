import { htmlLayout, textLayout, escapeHtml, fmtMoney, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface ApprovedTransactionProps {
  user_id: string;
  user_email?: string | null;
  user_name?: string | null;
  account_type?: string | null;
  amount: number;
  currency: string;
  reference: string;
  description?: string | null;
  occurred_at?: string | null;
  source_currency?: string | null;
  destination_currency?: string | null;
  destination_amount?: number | null;
  source_rail?: string | null;
  destination_rail?: string | null;
  deposit_id?: string | null;
}

export function render(p: ApprovedTransactionProps): RenderedEmail {
  const amount = fmtMoney(Number(p.amount), String(p.currency || "USD"));
  const rows: Array<[string, unknown]> = [
    ["Status", "Approved / completed"],
    ["Amount", amount],
    ["Customer", p.user_name || p.user_email || p.user_id],
    ["Customer email", p.user_email || "n/a"],
    ["Account type", p.account_type || "unknown"],
    ["Reference", p.reference],
    ["Deposit ID", p.deposit_id || "n/a"],
    ["Source", [p.source_currency, p.source_rail].filter(Boolean).join(" / ") || "n/a"],
    ["Destination", [p.destination_currency, p.destination_rail].filter(Boolean).join(" / ") || "n/a"],
    ["Destination amount", Number.isFinite(Number(p.destination_amount)) ? String(p.destination_amount) : "n/a"],
    ["Occurred", p.occurred_at || new Date().toISOString()],
  ];
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDERPAY_BRAND.border};border-radius:12px;padding:14px;margin:8px 0 0;">
    ${rows.map(([label, value]) => `<tr><td style="padding:7px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">${escapeHtml(label)}</td><td style="padding:7px 0;color:${BORDERPAY_BRAND.text};font-size:12px;font-family:'DM Mono',monospace;text-align:right;word-break:break-all;">${escapeHtml(String(value))}</td></tr>`).join("")}
  </table>${p.description ? `<p style="margin:16px 0 0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">${escapeHtml(p.description)}</p>` : ""}`;
  const subject = `Approved transaction: ${amount}`;
  return {
    subject,
    html: htmlLayout({
      preview: `${amount} · ${p.reference}`,
      heading: "Transaction approved",
      introText: "A provider-confirmed BorderPay transaction has completed.",
      body: table,
      ctaText: "Open BorderPay Admin",
      ctaUrl: "https://admin.borderpayafrica.com",
    }),
    text: textLayout({
      heading: "Transaction approved",
      body: rows.map(([label, value]) => `${label}: ${value}`).join("\n") + (p.description ? `\n\n${p.description}` : ""),
      ctaText: "Open BorderPay Admin",
      ctaUrl: "https://admin.borderpayafrica.com",
    }),
  };
}
