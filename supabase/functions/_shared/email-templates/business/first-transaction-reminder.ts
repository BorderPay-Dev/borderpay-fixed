import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail, escapeHtml } from "../layout.ts";

export interface BusinessFirstTransactionReminderProps {
  company_name?: string;
  minimum_deposit?: string;
  stablecoins?: string;
}

export function render(p: BusinessFirstTransactionReminderProps): RenderedEmail {
  const company = p.company_name || "your business";
  const min = p.minimum_deposit || "$50";
  const stable = p.stablecoins || "USDC/USDT";
  const subject = "Receive your first transfer to unlock business accounts";
  const heading = "Unlock business global accounts";
  const introText = `${escapeHtml(company)}, receive your first transfer or deposit at least ${escapeHtml(min)} in ${escapeHtml(stable)} to unlock USD, EUR & GBP receive accounts.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Funds stay in your wallet. No hidden charges.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Open BorderPay to receive funds and complete activation.
    </p>`;
  return {
    subject,
    html: htmlLayout({ preview: subject, heading, introText, body, ctaText: "Open dashboard", ctaUrl: `${BORDERPAY_BRAND.appUrl}/dashboard` }),
    text: textLayout({ heading, body: `Receive at least ${min} in ${stable} to unlock business global accounts.`, ctaText: "Open dashboard", ctaUrl: `${BORDERPAY_BRAND.appUrl}/dashboard` }),
  };
}

