import { escapeHtml, firstName, htmlLayout, textLayout, type RenderedEmail } from "./layout.ts";

export const APP_STORE_URL = "https://apps.apple.com/app/borderpay/id6791659887";
export const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.borderpayafrica.app";
export const APP_RELEASE = { version: "1.0.10", iosBuild: 73, androidBuild: 77 } as const;

export function render(p: { full_name?: string; company_name?: string; audience?: "individual" | "business"; ios_available?: boolean }): RenderedEmail {
  // Approval was confirmed by the operator. Public iOS availability is separate.
  const iosAvailable = p.ios_available === true;
  const subject = "Your BorderPay 1.0.10 update";
  const heading = "Meet BorderPay 1.0.10";
  const introText = p.audience === "business"
    ? `${p.company_name?.trim() || "Your business"} can benefit from the latest BorderPay improvements. Our iOS and Android updates have been approved.`
    : `Hello ${firstName(p.full_name)}, our latest iOS and Android updates have been approved.`;
  const improvements = p.audience === "business" ? [
    "Create and download business invoices and standard B2B agreements inside BorderPay.",
    "Keep supporting payment documents organized in one place.",
    "View recent business transactions on your dashboard.",
    "Clearer form guidance and improved reliability.",
  ] : ["Improved reliability and clearer in-app guidance."];
  const android = `Android: version ${APP_RELEASE.version} (build ${APP_RELEASE.androidBuild}) — approved for Google Play.`;
  const ios = iosAvailable
    ? `iPhone: version ${APP_RELEASE.version} (build ${APP_RELEASE.iosBuild}) is available on the App Store.`
    : `iPhone: version ${APP_RELEASE.version} (build ${APP_RELEASE.iosBuild}) — approved. Check the App Store for availability.`;
  const rollout = "If the update is not yet visible in your store, you can keep using your current app and check again later.";
  const nextStep = "After updating, open BorderPay and sign in with your existing account. You do not need to create a new account.";
  const link = (url: string, label: string) => `<p style="margin:16px 0;"><a href="${escapeHtml(url)}" target="_blank" style="display:block;padding:14px 20px;background:#C7FF00;color:#000000;font-size:15px;font-weight:700;text-align:center;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a></p>`;
  const body = `<p style="margin:0 0 12px;">This update includes:</p>
    <ul style="margin:0 0 20px;padding-left:22px;">${improvements.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <p>${escapeHtml(android)}</p>${link(GOOGLE_PLAY_URL, "Open Google Play")}
    <p>${escapeHtml(ios)}</p>${link(APP_STORE_URL, iosAvailable ? "Update on the App Store" : "Open the App Store")}
    <p>${escapeHtml(rollout)}</p><p>${escapeHtml(nextStep)}</p>`;
  const text = [introText, "This update includes:", ...improvements.map(item => `• ${item}`), android, GOOGLE_PLAY_URL, ios, APP_STORE_URL, rollout, nextStep].join("\n\n");
  return {
    subject,
    html: htmlLayout({ heading, introText, preview: subject, body, footerNote: "Thank you for choosing BorderPay." }),
    text: textLayout({ heading, body: text, footerNote: "Thank you for choosing BorderPay." }),
  };
}
