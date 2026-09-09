import { htmlLayout, textLayout, firstName, escapeHtml, RenderedEmail } from "../layout.ts";

export interface IndividualBusinessOnlyTransitionProps {
  full_name?: string;
  effective_date?: string;
}

const DEFAULT_EFFECTIVE_DATE = "August 24, 2026";

export function render(p: IndividualBusinessOnlyTransitionProps): RenderedEmail {
  const name = firstName(p.full_name);
  const effectiveDate = String(p.effective_date || DEFAULT_EFFECTIVE_DATE);
  const safeEffectiveDate = escapeHtml(effectiveDate);
  const subject = "An update about Individual accounts at BorderPay";
  const heading = "BorderPay is moving to Business-only signups";
  const introText = `Hello ${name}, we are updating who can open a new BorderPay account.`;
  const body = `
    <p style="margin:0 0 14px;color:#111111;font-size:14px;line-height:1.65;text-align:left;">
      Beginning <strong>${safeEffectiveDate}</strong>, new accounts opened directly with BorderPay will be available only to businesses.
    </p>
    <div style="margin:0 0 14px;padding:14px;border:1px solid #D8DED8;border-radius:10px;background:#FFFFFF;text-align:left;">
      <div style="color:#111111;font-size:14px;font-weight:800;margin-bottom:6px;">Your existing account remains available</div>
      <p style="margin:0;color:#111111;font-size:13px;line-height:1.65;">
        You can continue to sign in to and use your existing Individual account. This announcement does not convert or close your account.
      </p>
    </div>
    <p style="margin:0 0 14px;color:#111111;font-size:14px;line-height:1.65;text-align:left;">
      After this change, new Individual accounts may be offered through authorized BorderPay partners rather than through direct BorderPay signup.
    </p>
    <p style="margin:0;color:#425049;font-size:13px;line-height:1.65;text-align:left;">
      We are reviewing our inactive-account policy. If a future policy affects your account, we will notify you separately in advance and explain any balance, closure, and record-retention steps that apply.
    </p>
  `;
  const textBody = [
    introText,
    `Beginning ${effectiveDate}, new accounts opened directly with BorderPay will be available only to businesses.`,
    "Your existing account remains available. You can continue to sign in to and use your existing Individual account. This announcement does not convert or close your account.",
    "After this change, new Individual accounts may be offered through authorized BorderPay partners rather than through direct BorderPay signup.",
    "We are reviewing our inactive-account policy. If a future policy affects your account, we will notify you separately in advance and explain any balance, closure, and record-retention steps that apply.",
  ].join("\n\n");

  return {
    subject,
    html: htmlLayout({
      preview: "Existing Individual accounts remain available; new direct signups will be Business-only.",
      heading,
      introText,
      body,
      ctaText: "Open BorderPay",
      ctaUrl: "https://app.borderpayafrica.com",
      footerNote: "Questions? Contact support@borderpayafrica.com.",
    }),
    text: textLayout({
      heading,
      body: textBody,
      ctaText: "Open BorderPay",
      ctaUrl: "https://app.borderpayafrica.com",
      footerNote: "Questions? Contact support@borderpayafrica.com.",
    }),
  };
}
