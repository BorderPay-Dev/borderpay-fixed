import { htmlLayout, textLayout, escapeHtml, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface BusinessKybDecisionProps {
  company_name:  string;
  decision:      "approved" | "rejected";
  reason?:       string;
  next_steps?:   string;
}

export function render(p: BusinessKybDecisionProps): RenderedEmail {
  const SAFE_REJECTION_REASON = "Your information could not be verified";
  const company  = p.company_name || "your business";
  const approved = p.decision === "approved";

  const subject = approved
    ? `${company} has been verified on BorderPay`
    : `Action required — ${company} needs more Business Verification information`;

  const heading = approved ? "Business Verification approved" : "We need a bit more information";
  const introText = approved
    ? `Great news — ${company} is verified and your business account is fully active. Wallets, transfers, and cards are unlocked.`
    : `We reviewed your Business Verification submission for ${company} and couldn't verify it yet.`;

  const reasonBlock = !approved
    ? `<div style="background:${BORDERPAY_BRAND.bg};border-left:3px solid ${BORDERPAY_BRAND.warning};padding:14px 16px;border-radius:6px;margin:12px 0;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.55;">${escapeHtml(SAFE_REJECTION_REASON)}</div>`
    : "";

  const nextSteps = !approved
    ? (p.next_steps || "Please double-check your uploaded documents (all corners visible, no glare) and resubmit from the Business Verification steps on your dashboard.")
    : "";

  const body = approved
    ? `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
         You can now create wallets, send and receive funds, and issue corporate cards under ${escapeHtml(company)}.
       </p>`
    : `${reasonBlock}
       ${nextSteps ? `<p style="margin:14px 0 0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">${escapeHtml(nextSteps)}</p>` : ""}`;

  const ctaText = approved ? "Open Dashboard" : "Continue Business Verification";
  const ctaUrl  = `${BORDERPAY_BRAND.appUrl}/dashboard`;

  return {
    subject,
    html: htmlLayout({
      preview: subject, heading, introText, body, ctaText, ctaUrl,
      brandTone: approved ? "default" : "warning",
    }),
    text: textLayout({
      heading,
      body: approved
        ? `${company} verified. Account fully active.`
        : `${company} needs more Business Verification information.\nReason: ${SAFE_REJECTION_REASON}\nNext steps: ${nextSteps}`,
      ctaText, ctaUrl,
    }),
  };
}
