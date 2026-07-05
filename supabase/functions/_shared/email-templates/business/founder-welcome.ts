import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail, escapeHtml } from "../layout.ts";

export interface BusinessFounderWelcomeProps {
  full_name?: string;
  company_name?: string;
}

export function render(p: BusinessFounderWelcomeProps): RenderedEmail {
  const company = p.company_name || "your business";
  const subject = "Welcome to BorderPay Africa";
  const heading = "Welcome to BorderPay Business";
  const introText = `Hi ${escapeHtml(p.full_name || "there")},`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      I'm <strong style="color:${BORDERPAY_BRAND.text};">Mark Ikaba</strong>, Founder and CEO of BorderPay, and I wanted to personally thank you for joining us.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      BorderPay was created with one mission: to make moving money across borders simple, fast, and accessible for individuals and businesses across Africa and beyond.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Whether ${escapeHtml(company)} is using BorderPay to receive international payments, send money globally, manage multiple currencies, or grow internationally, we're committed to building a financial platform you can rely on.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      We're still at the beginning of our journey, and we are building BorderPay together with our early users. Your feedback shapes every product improvement we make.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Thank you once again for trusting BorderPay.<br/><br/>
      Warm regards,<br/>
      <strong style="color:${BORDERPAY_BRAND.text};">Mark Ikaba</strong><br/>
      Founder &amp; CEO<br/>
      BorderPay Africa
    </p>`;
  return {
    subject,
    html: htmlLayout({ preview: subject, heading, introText, body, ctaText: "Open dashboard", ctaUrl: `${BORDERPAY_BRAND.appUrl}/dashboard` }),
    text: textLayout({
      heading,
      body:
        `Hi ${p.full_name || "there"},\n\n` +
        `I'm Mark Ikaba, Founder and CEO of BorderPay, and I wanted to personally thank you for joining us.\n\n` +
        `We're excited to support ${company} with global payments and multi-currency wallet operations.\n\n` +
        `Warm regards,\nMark Ikaba\nFounder & CEO\nBorderPay Africa`,
      ctaText: "Open dashboard",
      ctaUrl: `${BORDERPAY_BRAND.appUrl}/dashboard`,
    }),
  };
}
