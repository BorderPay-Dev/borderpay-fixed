import { BORDERPAY_BRAND, escapeHtml, htmlLayout, RenderedEmail, textLayout } from "../layout.ts";

export interface SupportHandoffProps {
  ticket_number?: string;
  ticket_id?: string;
  requester_email?: string;
  requester_name?: string;
  issue_type?: string;
  subject?: string;
  message?: string;
  reasons?: string[];
  user_message_number?: number;
}

export function render(p: SupportHandoffProps): RenderedEmail {
  const ticketNumber = String(p.ticket_number || "Support ticket");
  const reasons = Array.isArray(p.reasons) && p.reasons.length > 0 ? p.reasons.join(", ") : "customer follow-up";
  const rows = [
    ["Ticket", ticketNumber],
    ["Customer", p.requester_name || "Customer"],
    ["Email", p.requester_email || "unknown"],
    ["Category", p.issue_type || "general"],
    ["Message number", String(p.user_message_number || 1)],
    ["Handoff reason", reasons],
  ];
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDERPAY_BRAND.border};border-radius:12px;padding:14px;margin:8px 0 0;">
    ${rows.map(([label, value]) => `<tr><td style="padding:7px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">${escapeHtml(label)}</td><td style="padding:7px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;word-break:break-word;">${escapeHtml(String(value))}</td></tr>`).join("")}
  </table>
  <p style="margin:16px 0 6px;color:${BORDERPAY_BRAND.text};font-size:14px;font-weight:700;">${escapeHtml(String(p.subject || "Support request"))}</p>
  <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;white-space:pre-wrap;">${escapeHtml(String(p.message || ""))}</p>`;
  const adminUrl = "https://admin.borderpayafrica.com/support-tools";

  return {
    subject: `[${ticketNumber}] Human support required`,
    html: htmlLayout({
      preview: `${ticketNumber}: ${p.subject || "customer support request"}`,
      heading: "Customer support handoff",
      introText: "A customer message requires human review. The customer was told not to open a duplicate ticket and to allow up to two hours.",
      body: table,
      ctaText: "Open support queue",
      ctaUrl: adminUrl,
      brandTone: "warning",
    }),
    text: textLayout({
      heading: "Customer support handoff",
      body: `${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\nSubject: ${p.subject || "Support request"}\n\nCustomer message:\n${p.message || ""}\n\nInternal ticket ID: ${p.ticket_id || "unknown"}`,
      ctaText: "Open support queue",
      ctaUrl: adminUrl,
    }),
  };
}
