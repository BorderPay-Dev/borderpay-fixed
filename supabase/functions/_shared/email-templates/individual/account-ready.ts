import { htmlLayout, textLayout, escapeHtml, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

/**
 * Individual global-account / wallet provisioning result — terminal only
 * (provisioned success or failed), per the webhook-email policy. Sent by the
 * worker on the terminal VA/wallet lifecycle outcome.
 */
export interface IndividualAccountReadyProps {
  full_name?: string;
  product:    "virtual_account" | "wallet";
  outcome:    "provisioned" | "failed";
  currency?:  string;
  reason?:    string;
}

export function render(p: IndividualAccountReadyProps): RenderedEmail {
  const name = firstName(p.full_name) || "there";
  const ok   = p.outcome === "provisioned";
  const productLabel = p.product === "wallet" ? "digital dollar wallet" : "global account";
  const cur  = p.currency ? `${p.currency.toUpperCase()} ` : "";

  const subject = ok
    ? `Your ${cur}${productLabel} is active`
    : `We couldn't set up your ${productLabel}`;

  const heading = ok ? "Your global account is active" : "Setup didn't complete";
  const introText = ok
    ? `Hi ${name}, your ${cur}${productLabel} is active and ready to receive payments.`
    : `Hi ${name}, we hit a problem setting up your ${cur}${productLabel}.`;

  const reasonBlock = !ok && p.reason
    ? `<div style="background:${BORDERPAY_BRAND.bg};border-left:3px solid ${BORDERPAY_BRAND.danger};padding:14px 16px;border-radius:6px;margin:12px 0;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.55;">${escapeHtml(p.reason)}</div>`
    : "";

  const closing = ok
    ? "Open BorderPay to view your account details and share them with clients or partners."
    : `Please try again from the app, or contact ${BORDERPAY_BRAND.supportEmail} if it persists.`;

  const body = ok
    ? `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${escapeHtml(closing)}</p>`
    : `${reasonBlock}
       <p style="margin:14px 0 0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">${escapeHtml(closing)}</p>`;

  return {
    subject,
    html: htmlLayout({
      preview: subject, heading, introText, body,
      ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.appUrl,
      brandTone: ok ? "default" : "danger",
    }),
    text: textLayout({
      heading,
      body: ok
        ? `Your ${cur}${productLabel} is active and ready to receive payments. Open BorderPay to view your account details.`
        : `Setup failed.\nReason: ${p.reason || "—"}\n${closing}`,
      ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
  };
}
