import { htmlLayout, textLayout, escapeHtml, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

/**
 * Individual KYC decision — terminal approve/reject only (per the webhook-email
 * policy). Sent by the worker on a terminal verification status.
 */
export interface IndividualKycDecisionProps {
  full_name?: string;
  decision:   "approved" | "rejected";
  reason?:    string;
  retryable?: boolean;
}

export function render(p: IndividualKycDecisionProps): RenderedEmail {
  const SAFE_REJECTION_REASON = "Your information could not be verified";
  const providedReason = String(p.reason || "").trim();
  const safeReason =
    providedReason &&
    !/developer reason|do not share|informational purposes only|for your informational purposes only/i.test(providedReason)
      ? providedReason
      : SAFE_REJECTION_REASON;
  const name     = firstName(p.full_name) || "there";
  const approved = p.decision === "approved";

  const subject = approved
    ? "You're verified on BorderPay"
    : "Your BorderPay verification didn't pass";

  const heading = approved ? "Identity verified" : "Verification didn't pass";
  const introText = approved
    ? `Hi ${name}, your identity is verified and your BorderPay account is active. You can now request supported account and wallet services from your dashboard.`
    : `Hi ${name}, we couldn't verify your identity this time.`;

  const reasonBlock = !approved
    ? `<div style="background:${BORDERPAY_BRAND.bg};border-left:3px solid ${BORDERPAY_BRAND.danger};padding:14px 16px;border-radius:6px;margin:12px 0;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.55;">${escapeHtml(safeReason)}</div>`
    : "";

  const closing = approved
    ? "Open BorderPay to view the services available for your account."
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
        ? "Identity verified. Open BorderPay to view the services available for your account."
        : `Verification didn't pass.\nReason: ${safeReason}\n${closing}`,
      ctaText, ctaUrl,
    }),
  };
}
