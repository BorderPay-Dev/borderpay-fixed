import { htmlLayout, textLayout, escapeHtml, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface BusinessKybSubmittedProps {
  company_name:    string;
  reference_id?:   string;
  submitted_at?:   string;
}

export function render(p: BusinessKybSubmittedProps): RenderedEmail {
  const company = p.company_name || "your business";
  const ref     = p.reference_id || "—";
  const submittedAt = p.submitted_at ? new Date(p.submitted_at).toUTCString() : new Date().toUTCString();
  const subject = `KYB submitted for ${company}`;
  const heading = "KYB review in progress";
  const introText = `Thanks — we've received the verification documents for ${company} and queued them for compliance review.`;
  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDERPAY_BRAND.border};border-radius:12px;padding:16px;margin:8px 0 0;">
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Company</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(company)}</td></tr>
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Reference</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:12px;font-family:'DM Mono',monospace;text-align:right;">${escapeHtml(ref)}</td></tr>
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Submitted</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(submittedAt)}</td></tr>
    </table>
    <p style="margin:18px 0 0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Reviews typically take <strong style="color:${BORDERPAY_BRAND.text};">1–2 business days</strong>. You'll get another email the moment a decision is made.
    </p>`;
  return {
    subject,
    html: htmlLayout({ preview: subject, heading, introText, body, ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.appUrl }),
    text: textLayout({ heading, body: `${company}\nReference: ${ref}\nSubmitted: ${submittedAt}\nTypical review window: 1–2 business days.`, ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.appUrl }),
  };
}
