import { htmlLayout, textLayout, escapeHtml, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface IncidentAlertProps {
  severity?: string;
  service?: string;
  title?: string;
  user_id?: string;
  account_type?: string;
  currency?: string;
  code?: string;
  provider_code?: string;
  provider_request_id?: string;
  message?: string;
  occurred_at?: string;
}

export function render(p: IncidentAlertProps): RenderedEmail {
  const severity = String(p.severity || "high").toUpperCase();
  const service = String(p.service || "borderpay").trim();
  const title = String(p.title || "BorderPay operational alert").trim();
  const occurredAt = String(p.occurred_at || new Date().toISOString());
  const rows = [
    ["Severity", severity],
    ["Service", service],
    ["User", p.user_id || "unknown"],
    ["Account type", p.account_type || "unknown"],
    ["Currency", p.currency || "n/a"],
    ["Code", p.code || "unknown"],
    ["Provider code", p.provider_code || "n/a"],
    ["Provider request", p.provider_request_id || "n/a"],
    ["Occurred", occurredAt],
  ];

  const table = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDERPAY_BRAND.border};border-radius:12px;padding:14px;margin:8px 0 0;">
      ${rows.map(([label, value]) => `
        <tr>
          <td style="padding:7px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">${escapeHtml(label)}</td>
          <td style="padding:7px 0;color:${BORDERPAY_BRAND.text};font-size:12px;font-family:'DM Mono',monospace;text-align:right;word-break:break-all;">${escapeHtml(String(value))}</td>
        </tr>
      `).join("")}
    </table>
    ${p.message ? `<p style="margin:16px 0 0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">${escapeHtml(p.message)}</p>` : ""}
  `;

  return {
    subject: `[${severity}] ${title}`,
    html: htmlLayout({
      preview: `${service}: ${p.code || "incident"}`,
      heading: title,
      introText: "A customer-facing financial account request needs operator review.",
      body: table,
      ctaText: "Open BorderPay Admin",
      ctaUrl: `${BORDERPAY_BRAND.appUrl}/settings`,
      brandTone: severity === "CRITICAL" ? "danger" : "warning",
    }),
    text: textLayout({
      heading: title,
      body: rows.map(([label, value]) => `${label}: ${value}`).join("\n") + (p.message ? `\n\n${p.message}` : ""),
      ctaText: "Open BorderPay Admin",
      ctaUrl: `${BORDERPAY_BRAND.appUrl}/settings`,
    }),
  };
}
