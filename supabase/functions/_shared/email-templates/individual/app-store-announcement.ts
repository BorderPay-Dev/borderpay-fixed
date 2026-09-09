import { appDownloadButtonsHtml, appDownloadLinksText, htmlLayout, textLayout, firstName, RenderedEmail } from "../layout.ts";

export interface IndividualAppStoreAnnouncementProps {
  full_name?: string;
}

export function render(p: IndividualAppStoreAnnouncementProps): RenderedEmail {
  const name = firstName(p.full_name);
  const subject = "BorderPay is now available on the App Store and Google Play";
  const heading = "BorderPay is now on iPhone and Android";
  const introText = `Hello ${name}, you can now download the BorderPay mobile app.`;
  const body = `
    <p style="margin:0 0 14px;color:#111111;font-size:14px;line-height:1.65;text-align:left;">
      BorderPay is officially available on the Apple App Store and Google Play. Download the app to securely access your account, manage your wallets, and make payments from your iPhone, iPad, or Android device.
    </p>
    ${appDownloadButtonsHtml()}
  `;
  const textBody = [
    introText,
    "BorderPay is officially available on the Apple App Store and Google Play. Download the app to securely access your account, manage your wallets, and make payments from your iPhone, iPad, or Android device.",
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
