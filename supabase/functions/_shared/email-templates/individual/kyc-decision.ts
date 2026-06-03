import { htmlLayout, textLayout, escapeHtml, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

/**
 * Individual KYC decision — terminal approve/reject only (per the webhook-email
 * policy). Sent by the worker on a TERMINAL Bridge customer/kyc_link status.
 */
export interface IndividualKycDecisionProps {
  full_name?: string;
  decision:   "approved" | "rejected";
  reason?:    string;
  retryable?: boolean;
}

export function render(p: IndividualKycDecisionProps): RenderedEmail {
  const name     = firstName(p.full_name) || "there";
  const approved = p.decision === "approved";

  const subject = approved
    ? "You're verified on BorderPay"
    : "Your BorderPay verification didn't pass";

  const heading = approved ? "Identity verified" : "Verification didn't pass";
  const introText = approved
    ? `Hi ${name}, your identity is verified and your BorderPay account is active. Virtual accounts and wallets are now available.`
    : `Hi ${name}, we couldn't verify your identity this time. Details are below.`;

  const reasonBlock = !approved && p.reason
    ? `<div style="background:${BORDERPAY_BRAND.bg};border-left:3px solid ${BORDERPAY_BRAND.danger};padding:14px 16px;border-radius:6px;margin:12px 0;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.55;">${escapeHtml(p.reason)}</div>`
    : "";

  const closing = approved
    ? "You can now provision a USD virtual account and a stablecoin wallet from your dashboard."
    : (p.retryable
        ? `You can retry verification from the app. If you have questions, contact ${BORDERPAY_BRAND.supportEmail}.`
        : `If you believe this is a mistake, contact ${BORDERPAY_BRAND.supportEmail}.`);

  const body = approved
    ? `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${escapeHtml(closing)}</p>`
    : `${reasonBlock}
       <p style="margin:14px 0 0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">${escapeHtml(closing)}</p>`;

  const ctaText = approved ? "Open BorderPay" : (p.retryable ? "Retry verification" : "Contact support");
  const ctaUrl  = approved ? BORDERPAY_BRAND.appUrl
                : p.retryable ? `${BORDERPAY_BRAND.appUrl}/kyc`
                : `mailto:${BORDERPAY_BRAND.supportEmail}`;

  return {
    subject,
    html: htmlLayout({
      preview: subject, heading, introText, body, ctaText, ctaUrl,
      brandTone: approved ? "default" : "danger",
    }),
    text: textLayout({
      heading,
      body: approved
        ? "Identity verified. Virtual accounts and wallets are available."
        : `Verification didn't pass.\nReason: ${p.reason || "—"}\n${closing}`,
      ctaText, ctaUrl,
    }),
  };
}
