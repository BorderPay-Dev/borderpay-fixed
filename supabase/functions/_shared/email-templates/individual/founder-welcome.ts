import { htmlLayout, textLayout, firstName, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface IndividualFounderWelcomeProps {
  full_name?: string;
}

export function render(p: IndividualFounderWelcomeProps): RenderedEmail {
  const fn = firstName(p.full_name) || "there";
  const subject = "Welcome to BorderPay";
  const heading = "Welcome to BorderPay";
  const introText = `Hi ${fn}, I'm Mark Ikaba, Founder & CEO of BorderPay. Thank you for joining us.`;

  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      BorderPay exists to make moving money across borders simple, fast, and accessible for individuals and businesses.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      You can use BorderPay to receive international payments, manage multiple currencies, and send funds globally with confidence.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      We are still early, and your feedback directly shapes what we build next.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      Warm regards,<br />
      <strong>Mark Ikaba</strong><br />
      Founder &amp; CEO, BorderPay
    </p>
  `;

  return {
    subject,
    html: htmlLayout({
      preview: "Welcome to BorderPay",
      heading,
      introText,
      body,
      ctaText: "Open BorderPay",
      ctaUrl: BORDERPAY_BRAND.appUrl,
      footerNote: "If you have any questions, just reply to this email.",
    }),
    text: textLayout({
      heading,
      body:
        "Welcome to BorderPay.\n\n" +
        "BorderPay exists to make moving money across borders simple, fast, and accessible.\n\n" +
        "Warm regards,\nMark Ikaba\nFounder & CEO, BorderPay",
      ctaText: "Open BorderPay",
      ctaUrl: BORDERPAY_BRAND.appUrl,
      footerNote: "If you have any questions, just reply to this email.",
    }),
  };
}

