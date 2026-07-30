import { htmlLayout, textLayout, escapeHtml, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface IndividualBulkPaymentInviteProps {
  business_name?: string;
  amount: string | number;
  stablecoin: "USDC" | "USDT" | string;
  signup_url?: string;
}

export function render(p: IndividualBulkPaymentInviteProps): RenderedEmail {
  const business = String(p.business_name || "A business").trim();
  const amount = String(p.amount || "").trim();
  const stablecoin = String(p.stablecoin || "USDC").toUpperCase();
  const signupUrl = p.signup_url || `${BORDERPAY_BRAND.appUrl}/signup`;
  const paymentLabel = `${amount} ${stablecoin}`.trim();

  const subject = `${paymentLabel} is waiting for you at BorderPay`;
  const heading = "A business payment is waiting";
  const introText = `${business} has sent a payment invitation through BorderPay Africa.`;
  const body = `
    <p style="margin:0 0 14px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Create your BorderPay account with this email address, then complete verification to receive or withdraw your payment.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background:${BORDERPAY_BRAND.bg};border:1px solid ${BORDERPAY_BRAND.border};border-radius:8px;">
      <tr>
        <td style="padding:14px 16px;font-size:13px;color:${BORDERPAY_BRAND.textMuted};line-height:1.6;">
          <strong style="color:${BORDERPAY_BRAND.text};">From</strong><br />
          ${escapeHtml(business)}
        </td>
      </tr>
      <tr>
        <td style="padding:0 16px 14px;font-size:13px;color:${BORDERPAY_BRAND.textMuted};line-height:1.6;">
          <strong style="color:${BORDERPAY_BRAND.text};">Payment</strong><br />
          ${escapeHtml(paymentLabel)}
        </td>
      </tr>
    </table>
    <p style="margin:14px 0 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;line-height:1.6;text-align:center;">
      This payment will stay pending until your BorderPay account is created and verified.
    </p>`;
  const footerNote = "Use the same email address that received this message so we can match the payment to your account.";

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body,
      ctaText: "Create account",
      ctaUrl: signupUrl,
      footerNote,
    }),
    text: textLayout({
      heading,
      body: `${business} has a ${paymentLabel} payment waiting for you at BorderPay Africa. Create your account with this email address and complete verification to receive or withdraw it.`,
      ctaText: "Create account",
      ctaUrl: signupUrl,
      footerNote,
    }),
  };
}
