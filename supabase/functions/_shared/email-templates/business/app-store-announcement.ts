import { htmlLayout, textLayout, RenderedEmail } from "../layout.ts";

const APP_STORE_URL = "https://apps.apple.com/app/borderpay/id6791659887";

export interface BusinessAppStoreAnnouncementProps {
  company_name?: string;
}

export function render(p: BusinessAppStoreAnnouncementProps): RenderedEmail {
  const company = String(p.company_name || "Your business").trim();
  const subject = "BorderPay is now available on the App Store";
  const heading = "BorderPay is now on the App Store";
  const introText = `${company} can now access BorderPay from the iPhone app.`;
  const body = `
    <p style="margin:0 0 14px;color:#111111;font-size:14px;line-height:1.65;text-align:left;">
      BorderPay is officially available on the Apple App Store. Download the app to securely access your business account, manage wallets, and make payments from your iPhone.
    </p>
    <div style="margin:0;padding:14px;border:1px solid #D8DED8;border-radius:10px;background:#FFFFFF;text-align:left;">
      <div style="color:#111111;font-size:14px;font-weight:800;margin-bottom:6px;">Android availability</div>
      <p style="margin:0;color:#111111;font-size:13px;line-height:1.65;">BorderPay for Google Play is coming soon. We will notify you when it is available.</p>
    </div>
  `;
  const textBody = [
    introText,
    "BorderPay is officially available on the Apple App Store. Download the app to securely access your business account, manage wallets, and make payments from your iPhone.",
    "BorderPay for Google Play is coming soon. We will notify you when it is available.",
  ].join("\n\n");

  return {
    subject,
    html: htmlLayout({
      preview: "Download BorderPay for iPhone today. Google Play is coming soon.",
      heading,
      introText,
      body,
      ctaText: "Download on the App Store",
      ctaUrl: APP_STORE_URL,
      footerNote: "Thank you for choosing BorderPay.",
    }),
    text: textLayout({
      heading,
      body: textBody,
      ctaText: "Download on the App Store",
      ctaUrl: APP_STORE_URL,
      footerNote: "Thank you for choosing BorderPay.",
    }),
  };
}
