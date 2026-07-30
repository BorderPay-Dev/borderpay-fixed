import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface BusinessStablecoinFreeAnnouncementProps {
  company_name?: string;
  action_url?: string;
}

export function render(p: BusinessStablecoinFreeAnnouncementProps): RenderedEmail {
  const company = String(p.company_name || "your business").trim();
  const appUrl = String(p.action_url || `${BORDERPAY_BRAND.appUrl}/dashboard`);
  const subject = `${company}: USDC and USDT receive and payout are free`;
  const heading = "USDC and USDT are free to receive and send out";
  const introText = `${company} can use supported USDC and USDT wallet transfers with no BorderPay transaction fee.`;

  const body = `
    <p style="margin:0 0 14px;color:#111111;font-size:14px;line-height:1.65;text-align:left;">
      Your business can use BorderPay USDC and USDT wallets for supported digital dollar receive and payout activity without a BorderPay transaction fee.
    </p>

    <div style="margin:0 0 16px;padding:14px;border:1px solid #D8DED8;border-radius:10px;background:#FFFFFF;text-align:left;">
      <div style="color:#111111;font-size:14px;font-weight:800;margin-bottom:8px;">What is free</div>
      <ul style="margin:0;padding-left:18px;color:#111111;font-size:13px;line-height:1.65;">
        <li><strong style="color:#111111;">Receive USDC:</strong> receive supported USDC wallet deposits.</li>
        <li><strong style="color:#111111;">Receive USDT:</strong> receive supported USDT wallet deposits.</li>
        <li><strong style="color:#111111;">Payout USDC:</strong> send USDC to a supported external USDC wallet address with no BorderPay transaction fee.</li>
        <li><strong style="color:#111111;">Payout USDT:</strong> send USDT to a supported external USDT wallet address with no BorderPay transaction fee.</li>
      </ul>
    </div>

    <div style="margin:0 0 16px;padding:14px;border:1px solid #D8DED8;border-radius:10px;background:#FFFFFF;text-align:left;">
      <div style="color:#111111;font-size:14px;font-weight:800;margin-bottom:8px;">How your business can use it</div>
      <ol style="margin:0;padding-left:18px;color:#111111;font-size:13px;line-height:1.65;">
        <li>Open BorderPay and go to the business wallet screen.</li>
        <li>Choose USDC or USDT.</li>
        <li>Use Receive to copy wallet details, or Send to pay out to an external wallet.</li>
        <li>Confirm the correct network, recipient wallet address, and amount before sending.</li>
      </ol>
    </div>

    <p style="margin:0;color:#111111;font-size:14px;line-height:1.65;text-align:left;">
      Fiat account deposits, conversions, African rails, bank payouts, cross-token routes, or third-party provider charges may still have fees where shown before confirmation. Compliance checks and wallet/network availability may also apply.
    </p>
  `;

  const textBody = [
    introText,
    "Your business can use BorderPay USDC and USDT wallets for supported digital dollar receive and payout activity without a BorderPay transaction fee.",
    "What is free:\n- Receive supported USDC wallet deposits.\n- Receive supported USDT wallet deposits.\n- Send USDC to a supported external USDC wallet address with no BorderPay transaction fee.\n- Send USDT to a supported external USDT wallet address with no BorderPay transaction fee.",
    "How your business can use it:\n1. Open BorderPay and go to the business wallet screen.\n2. Choose USDC or USDT.\n3. Use Receive to copy wallet details, or Send to pay out to an external wallet.\n4. Confirm the correct network, recipient wallet address, and amount before sending.",
    "Fiat account deposits, conversions, African rails, bank payouts, cross-token routes, or third-party provider charges may still have fees where shown before confirmation. Compliance checks and wallet/network availability may also apply.",
  ].join("\n\n");

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body,
      ctaText: "Open business dashboard",
      ctaUrl: appUrl,
      footerNote: "For help with USDC or USDT business transfers, reply to this email or contact BorderPay support.",
    }),
    text: textLayout({
      heading,
      body: textBody,
      ctaText: "Open business dashboard",
      ctaUrl: appUrl,
      footerNote: "For help with USDC or USDT business transfers, reply to this email or contact BorderPay support.",
    }),
  };
}
