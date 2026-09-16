import { escapeHtml, firstName, htmlLayout, textLayout, type RenderedEmail } from "./layout.ts";

export const APP_STORE_URL = "https://apps.apple.com/app/borderpay/id6791659887";
export const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.borderpayafrica.app";

export function render(p: { full_name?: string; ios_available?: boolean }): RenderedEmail {
  // Apple approval and public availability must be confirmed by the operator.
  const iosAvailable = p.ios_available === true;
  const subject = iosAvailable
    ? "Update your BorderPay app to version 1.0.8"
    : "BorderPay 1.0.8: Android update available";
  const heading = "Your BorderPay app update";
  const introText = `Hello ${firstName(p.full_name)}, we have made improvements to your BorderPay experience.`;
  const improvements = [
    "Clearer wallet and balance loading.",
    "Improved access to saved bank accounts and withdrawal wallets.",
    "Easier continuation of identity and business verification.",
  ];
  const android = "Android: version 1.0.8 is available now on Google Play. Please update your app.";
  const ios = iosAvailable
    ? "iPhone: version 1.0.8 is available now on the App Store. Please update your app."
    : "iPhone: version 1.0.8 is still under Apple review. You can continue using your current app and check the App Store for the update once it is released.";
  const nextStep = "After updating, open BorderPay and sign in with your existing account.";
  const link = (url: string, label: string) => `<p style="margin:16px 0;"><a href="${escapeHtml(url)}" target="_blank" style="display:block;padding:14px 20px;background:#C7FF00;color:#000000;font-size:15px;font-weight:700;text-align:center;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a></p>`;
  const body = `
    <p style="margin:0 0 12px;">This update includes:</p>
    <ul style="margin:0 0 20px;padding-left:22px;">${improvements.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <p>${escapeHtml(android)}</p>
    ${link(GOOGLE_PLAY_URL, "Update on Google Play")}
    <p>${escapeHtml(ios)}</p>
    ${link(APP_STORE_URL, iosAvailable ? "Update on the App Store" : "View on the App Store")}
    <p>${escapeHtml(nextStep)}</p>`;
  const text = [introText, "This update includes:", ...improvements.map(item => `• ${item}`),
    android, GOOGLE_PLAY_URL, ios, APP_STORE_URL, nextStep].join("\n\n");
  return {
    subject,
    html: htmlLayout({ heading, introText, preview: subject, body, footerNote: "Thank you for choosing BorderPay." }),
    text: textLayout({ heading, body: text, footerNote: "Thank you for choosing BorderPay." }),
  };
}
