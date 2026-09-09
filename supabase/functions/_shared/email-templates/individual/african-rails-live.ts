import { BORDERPAY_BRAND, firstName, htmlLayout, RenderedEmail, textLayout } from "../layout.ts";

export interface IndividualAfricanRailsLiveProps {
  full_name?: string;
  action_url?: string;
}

export function render(p: IndividualAfricanRailsLiveProps): RenderedEmail {
  const name = firstName(p.full_name);
  const actionUrl = String(p.action_url || BORDERPAY_BRAND.smartAppUrl);
  const subject = "African payment rails are now live on BorderPay";
  const heading = "African payment rails are live";
  const introText = `Hello ${name}, supported African bank and mobile money rails are now available through BorderPay.`;
  const body = `
    <p style="margin:0 0 14px;color:#111111;font-size:14px;line-height:1.65;text-align:left;">
      Use BorderPay to send money through the bank and mobile money methods currently available for each supported African market.
    </p>
    <div style="margin:0 0 16px;padding:14px;border:1px solid #D8DED8;border-radius:10px;background:#FFFFFF;text-align:left;">
      <div style="color:#111111;font-size:14px;font-weight:800;margin-bottom:8px;">What to expect</div>
      <ul style="margin:0;padding-left:18px;color:#111111;font-size:13px;line-height:1.65;">
        <li>Available countries, currencies, banks, and mobile money networks are shown in the app.</li>
        <li>Receive options are based on your verified country and current provider availability.</li>
        <li>The exchange rate, fee, recipient amount, and estimated delivery time are shown before confirmation.</li>
      </ul>
    </div>
    <p style="margin:0;color:#111111;font-size:14px;line-height:1.65;text-align:left;">
      Rail availability can change. If a method is temporarily unavailable, it will not be offered for a new transaction.
    </p>
  `;
  const textBody = [
    introText,
    "Use BorderPay to send money through the bank and mobile money methods currently available for each supported African market.",
    "What to expect:\n- Available countries, currencies, banks, and mobile money networks are shown in the app.\n- Receive options are based on your verified country and current provider availability.\n- The exchange rate, fee, recipient amount, and estimated delivery time are shown before confirmation.",
    "Rail availability can change. If a method is temporarily unavailable, it will not be offered for a new transaction.",
  ].join("\n\n");

  return {
    subject,
    html: htmlLayout({
      preview: "Supported African bank and mobile money rails are now available.",
      heading,
      introText,
      body,
      ctaText: "Open BorderPay",
      ctaUrl: actionUrl,
      footerNote: "Availability depends on the destination, verified customer details, and live provider coverage.",
    }),
    text: textLayout({
      heading,
      body: textBody,
      ctaText: "Open BorderPay",
      ctaUrl: actionUrl,
      footerNote: "Availability depends on the destination, verified customer details, and live provider coverage.",
    }),
  };
}
