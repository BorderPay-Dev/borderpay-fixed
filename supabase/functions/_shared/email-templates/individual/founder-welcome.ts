import { htmlLayout, textLayout, firstName, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface IndividualFounderWelcomeProps {
  full_name?: string;
}

export function render(p: IndividualFounderWelcomeProps): RenderedEmail {
  const fn = firstName(p.full_name);
  const subject = "Welcome to BorderPay Africa";
  const heading = "Welcome to BorderPay";
  const introText = `Hi ${fn},`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      I'm <strong style="color:${BORDERPAY_BRAND.text};">Mark Ikaba</strong>, Founder and CEO of BorderPay, and I wanted to personally thank you for joining us.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      BorderPay was created with one mission: to make moving money across borders simple, fast, and accessible for individuals and businesses across Africa and beyond.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Whether you're using BorderPay to receive international payments, send money globally, manage multiple currencies, or grow your business internationally, we're committed to building a financial platform you can rely on.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      We're still at the beginning of our journey, and we're building BorderPay together with our early users. Your feedback, ideas, and experiences help shape every product improvement we make.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Over the coming months, you'll continue to see improvements in account reliability, cross-border payments, and wallet experience as we grow with our users.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      If you ever have questions, suggestions, or simply want to tell us about your experience, we'd genuinely love to hear from you. Every message is read by our team.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      I'd also love the opportunity to get to know some of our users personally. If you'd like a short conversation about your experience or how BorderPay can better support your needs, simply reply to this email.
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
        `Hi ${fn},\n\n` +
        `I'm Mark Ikaba, Founder and CEO of BorderPay, and I wanted to personally thank you for joining us.\n\n` +
        `BorderPay was created with one mission: to make moving money across borders simple, fast, and accessible for individuals and businesses across Africa and beyond.\n\n` +
        `We're committed to building a financial platform you can rely on. Reply anytime with feedback — every message is read by our team.\n\n` +
        `Warm regards,\nMark Ikaba\nFounder & CEO\nBorderPay Africa`,
      ctaText: "Open dashboard",
      ctaUrl: `${BORDERPAY_BRAND.appUrl}/dashboard`,
    }),
  };
}
