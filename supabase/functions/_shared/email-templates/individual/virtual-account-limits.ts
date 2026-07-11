import { htmlLayout, textLayout, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

export interface IndividualVirtualAccountLimitsProps {
  full_name?: string;
}

const sectionStyle = `margin:18px 0 0;padding:16px;border:1px solid ${BORDERPAY_BRAND.border};border-radius:8px;background:#050505;`;
const titleStyle = `margin:0 0 8px;color:${BORDERPAY_BRAND.text};font-size:15px;font-weight:700;`;
const listStyle = `margin:0;padding-left:18px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.7;`;
const noteStyle = `margin:18px 0 0;color:${BORDERPAY_BRAND.textFaint};font-size:13px;line-height:1.6;`;

export function render(p: IndividualVirtualAccountLimitsProps): RenderedEmail {
  const name = firstName(p.full_name) || "there";
  const subject = "Your virtual account limits";
  const heading = "Virtual account limits";
  const introText = `Hi ${name}, your USD, EUR, and GBP account details are available subject to Bridge rail availability, compliance review, and account status.`;

  const body = `
    <div style="${sectionStyle}">
      <p style="${titleStyle}">USD (ACH / Wire / FedNow)</p>
      <ul style="${listStyle}">
        <li>On-ramp: 1st party deposits permitted.</li>
        <li>3rd party P2P deposits: under $4,000.</li>
        <li>FedNow on-ramp: up to $10,000,000 per transaction.</li>
        <li>Off-ramp: unlimited.</li>
      </ul>
    </div>

    <div style="${sectionStyle}">
      <p style="${titleStyle}">EUR (SEPA)</p>
      <ul style="${listStyle}">
        <li>On-ramp: 1st party deposits are unlimited.</li>
        <li>3rd party deposits from individuals: contact your account manager.</li>
        <li>Minimum transaction: EUR 1.</li>
        <li>Transfers over EUR 1,000,000 use SEPA Credit and may take 1 business day.</li>
        <li>Off-ramp: unlimited, minimum EUR 1.</li>
      </ul>
    </div>

    <div style="${sectionStyle}">
      <p style="${titleStyle}">GBP (Faster Payments)</p>
      <ul style="${listStyle}">
        <li>On-ramp: 1st party deposits are unlimited.</li>
        <li>3rd party deposits from individuals are unavailable.</li>
        <li>Minimum on-ramp: GBP 2.00.</li>
        <li>Minimum off-ramp: 3.00 of the source currency.</li>
        <li>Transfers over GBP 1,000,000 use BACS and may take 3 business days.</li>
        <li>Off-ramp: unlimited.</li>
      </ul>
    </div>

    <p style="${noteStyle}">These limits are provided for operational guidance. BorderPay may request additional information where required by Bridge, a banking rail, or compliance review.</p>
  `;

  const text = [
    "USD (ACH / Wire / FedNow)",
    "- On-ramp: 1st party deposits permitted.",
    "- 3rd party P2P deposits: under $4,000.",
    "- FedNow on-ramp: up to $10,000,000 per transaction.",
    "- Off-ramp: unlimited.",
    "",
    "EUR (SEPA)",
    "- On-ramp: 1st party deposits are unlimited.",
    "- 3rd party deposits from individuals: contact your account manager.",
    "- Minimum transaction: EUR 1.",
    "- Transfers over EUR 1,000,000 use SEPA Credit and may take 1 business day.",
    "- Off-ramp: unlimited, minimum EUR 1.",
    "",
    "GBP (Faster Payments)",
    "- On-ramp: 1st party deposits are unlimited.",
    "- 3rd party deposits from individuals are unavailable.",
    "- Minimum on-ramp: GBP 2.00.",
    "- Minimum off-ramp: 3.00 of the source currency.",
    "- Transfers over GBP 1,000,000 use BACS and may take 3 business days.",
    "- Off-ramp: unlimited.",
    "",
    "These limits are provided for operational guidance. BorderPay may request additional information where required by Bridge, a banking rail, or compliance review.",
  ].join("\n");

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body,
      ctaText: "Open BorderPay",
      ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
    text: textLayout({ heading, body: text, ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.appUrl }),
  };
}
