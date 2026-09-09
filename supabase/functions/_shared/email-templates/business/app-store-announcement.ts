import { appDownloadButtonsHtml, appDownloadLinksText, htmlLayout, textLayout, RenderedEmail } from "../layout.ts";

export interface BusinessAppStoreAnnouncementProps {
  company_name?: string;
}

export function render(p: BusinessAppStoreAnnouncementProps): RenderedEmail {
  const company = String(p.company_name || "Your business").trim();
  const subject = "BorderPay is now available on the App Store and Google Play";
  const heading = "BorderPay is now on iPhone and Android";
  const introText = `${company} can now access BorderPay from the mobile app.`;
  const body = `
    <p style="margin:0 0 14px;color:#111111;font-size:14px;line-height:1.65;text-align:left;">
      BorderPay is officially available on the Apple App Store and Google Play. Download the app to securely access your business account, manage wallets, and make payments from your iPhone, iPad, or Android device.
    </p>
    ${appDownloadButtonsHtml()}
  `;
  const textBody = [
    introText,
    "BorderPay is officially available on the Apple App Store and Google Play. Download the app to securely access your business account, manage wallets, and make payments from your iPhone, iPad, or Android device.",
    appDownloadLinksText(),
  ].join("\n\n");

  return {
    subject,
    html: htmlLayout({
      preview: "Download BorderPay for iPhone, iPad, or Android.",
      heading,
      introText,
      body,
      footerNote: "Thank you for choosing BorderPay.",
    }),
    text: textLayout({
      heading,
      body: textBody,
      footerNote: "Thank you for choosing BorderPay.",
    }),
  };
}
