import { htmlLayout, textLayout, escapeHtml, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

/**
 * Business virtual-account / wallet provisioning result — terminal only
 * (provisioned success or failed), per the webhook-email policy. Distinct from
 * business.account_activated (whole-business go-live); this is per-product.
 */
export interface BusinessAccountReadyProps {
  company_name?: string;
  product:       "virtual_account" | "wallet";
  outcome:       "provisioned" | "failed";
  currency?:     string;
  reason?:       string;
}

export function render(p: BusinessAccountReadyProps): RenderedEmail {
  const company = p.company_name || "your business";
  const ok      = p.outcome === "provisioned";
  const productLabel = p.product === "wallet" ? "stablecoin wallet" : "virtual account";
  const cur     = p.currency ? `${p.currency.toUpperCase()} ` : "";

  const subject = ok
    ? `${company}: ${cur}${productLabel} is ready`
    : `${company}: ${productLabel} setup didn't complete`;

  const heading = ok ? "Account ready" : "Setup didn't complete";
  const introText = ok
    ? `${company}'s ${cur}${productLabel} is provisioned and ready to use.`
    : `We hit a problem setting up a ${cur}${productLabel} for ${company}.`;

  const reasonBlock = !ok && p.reason
    ? `<div style="background:${BORDERPAY_BRAND.bg};border-left:3px solid ${BORDERPAY_BRAND.danger};padding:14px 16px;border-radius:6px;margin:12px 0;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.55;">${escapeHtml(p.reason)}</div>`
    : "";

  const closing = ok
    ? "Open BorderPay to see the account details."
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
        ? `${company}: ${cur}${productLabel} is ready.`
        : `${company}: setup failed.\nReason: ${p.reason || "—"}\n${closing}`,
      ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
  };
}
