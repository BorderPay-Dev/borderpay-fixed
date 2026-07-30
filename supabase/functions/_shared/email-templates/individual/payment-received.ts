import { htmlLayout, textLayout, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";
import { render as renderTransactionStatus, TransactionStatusProps } from "./transaction-status.ts";

/**
 * Legacy template key retained for compatibility.
 *
 * If a stale caller still uses `individual.payment_received` for a real
 * money-in event, render the current Bridge-style transaction receipt instead
 * of the old verification email. Verification-link callers continue to work
 * only when they pass `kyc_url`.
 */
export interface IndividualPaymentReceivedProps extends Partial<TransactionStatusProps> {
  full_name?: string;
  kyc_url?:   string;
}

export function render(p: IndividualPaymentReceivedProps): RenderedEmail {
  if (p.amount !== undefined && p.currency && p.reference) {
    return renderTransactionStatus({
      ...p,
      status: p.status || "approved",
      amount: Number(p.amount),
      currency: String(p.currency),
      reference: String(p.reference),
    } as TransactionStatusProps);
  }

  const name = firstName(p.full_name) || "there";
  const url = p.kyc_url || BORDERPAY_BRAND.appUrl;
  const subject = "Verify your identity";
  const heading = "Verify your identity";
  const introText = `Hi ${name}, your BorderPay account is ready for verification.`;
  const closing = "Verify your identity to unlock your BorderPay account. Tap the button below to start secure verification — it only takes a few minutes.";

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${closing}</p>`,
      ctaText: "Verify your identity",
      ctaUrl: url,
      brandTone: "default",
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${closing}`,
      ctaText: "Verify your identity",
      ctaUrl: url,
    }),
  };
}
