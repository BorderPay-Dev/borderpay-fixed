import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";
import { render as renderTransactionStatus, TransactionStatusProps } from "./transaction-status.ts";

/**
 * Legacy template key retained for compatibility.
 *
 * If a stale caller still uses `business.payment_received` for a real money-in
 * event, render the current Bridge-style transaction receipt instead of the old
 * verification email. Verification-link callers continue to work only when they
 * pass `kyc_url`.
 */
export interface BusinessPaymentReceivedProps extends Partial<TransactionStatusProps> {
  company_name?: string;
  kyc_url?:       string;
}

export function render(p: BusinessPaymentReceivedProps): RenderedEmail {
  if (p.amount !== undefined && p.currency && p.reference) {
    return renderTransactionStatus({
      ...p,
      status: p.status || "approved",
      amount: Number(p.amount),
      currency: String(p.currency),
      reference: String(p.reference),
    } as TransactionStatusProps);
  }

  const name = p.company_name || "there";
  const url = p.kyc_url || BORDERPAY_BRAND.appUrl;
  const subject = "Verify your business";
  const heading = "Verify your business";
  const introText = `${name} is ready for BorderPay business verification.`;
  const closing = "Complete business verification to unlock your BorderPay account. Tap the button below to start secure verification.";

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${closing}</p>`,
      ctaText: "Verify your business",
      ctaUrl: url,
      brandTone: "default",
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${closing}`,
      ctaText: "Verify your business",
      ctaUrl: url,
    }),
  };
}
