import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface BusinessVirtualAccountLimitsProps {
  company_name?: string;
}

const sectionStyle = `margin:18px 0 0;padding:16px;border:1px solid ${BORDERPAY_BRAND.border};border-radius:8px;background:#050505;`;
const titleStyle = `margin:0 0 8px;color:${BORDERPAY_BRAND.text};font-size:15px;font-weight:700;`;
const listStyle = `margin:0;padding-left:18px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.7;`;
const noteStyle = `margin:18px 0 0;color:${BORDERPAY_BRAND.textFaint};font-size:13px;line-height:1.6;`;

export function render(p: BusinessVirtualAccountLimitsProps): RenderedEmail {
  const company = p.company_name || "your business";
  const subject = `${company}: virtual account limits`;
  const heading = "Business virtual account limits";
  const introText = `${company}'s USD, EUR, and GBP account details are available subject to Bridge rail availability, compliance review, and account status.`;

  const body = `
    <div style="${sectionStyle}">
      <p style="${titleStyle}">EUR (SEPA)</p>
      <ul style="${listStyle}">
        <li>Incoming from 3rd party businesses: unlimited.</li>
        <li>Outgoing to businesses: unlimited.</li>
        <li>Minimum transaction: EUR 1.</li>
        <li>No maximum transaction amount. Transfers of EUR 1,000,000 or more use SEPA Credit and may take 1-3 business days.</li>
      </ul>
    </div>

    <div style="${sectionStyle}">
      <p style="${titleStyle}">GBP (Faster Payments)</p>
      <ul style="${listStyle}">
        <li>Incoming from 3rd party businesses: unlimited.</li>
        <li>Outgoing to businesses: unlimited.</li>
        <li>Minimum on-ramp: GBP 2.00.</li>
        <li>Minimum off-ramp: 3.00 of the source currency.</li>
        <li>No maximum transaction amount. Transfers of GBP 1,000,000 or more use BACS and may take 3 business days.</li>
      </ul>
    </div>

    <div style="${sectionStyle}">
      <p style="${titleStyle}">USD (ACH / Wire)</p>
      <ul style="${listStyle}">
        <li>Incoming from businesses: unlimited.</li>
        <li>Outgoing to businesses: unlimited.</li>
        <li>Same Day ACH maximum: USD 1,000,000 per transaction.</li>
      </ul>
    </div>

    <p style="${noteStyle}">3rd party deposits from individuals are unavailable for GBP. For EUR individual 3rd party deposit support, contact BorderPay support. BorderPay may request additional information where required by Bridge, a banking rail, or compliance review.</p>
  `;

  const text = [
    "EUR (SEPA)",
    "- Incoming from 3rd party businesses: unlimited.",
    "- Outgoing to businesses: unlimited.",
    "- Minimum transaction: EUR 1.",
    "- No maximum transaction amount. Transfers of EUR 1,000,000 or more use SEPA Credit and may take 1-3 business days.",
    "",
    "GBP (Faster Payments)",
    "- Incoming from 3rd party businesses: unlimited.",
    "- Outgoing to businesses: unlimited.",
    "- Minimum on-ramp: GBP 2.00.",
    "- Minimum off-ramp: 3.00 of the source currency.",
    "- No maximum transaction amount. Transfers of GBP 1,000,000 or more use BACS and may take 3 business days.",
    "",
    "USD (ACH / Wire)",
    "- Incoming from businesses: unlimited.",
    "- Outgoing to businesses: unlimited.",
    "- Same Day ACH maximum: USD 1,000,000 per transaction.",
    "",
    "3rd party deposits from individuals are unavailable for GBP. For EUR individual 3rd party deposit support, contact BorderPay support. BorderPay may request additional information where required by Bridge, a banking rail, or compliance review.",
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
