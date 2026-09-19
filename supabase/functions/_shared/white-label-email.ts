export type EmailBrand = {
  brandName: string;
  primaryColor: string;
  logoUrl: string | null;
  supportEmail: string | null;
  appOrigin: string;
  legalName: string;
  termsUrl: string;
  privacyUrl: string;
};
const defaultLogo =
  "https://orwrcpwsffjlvzuraxjc.supabase.co/storage/v1/object/public/email-logo.png/assets/borderpay-email-logo.png";
export const escapeBrand = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export function applyWhiteLabelEmail(
  rendered: { subject: string; html: string; text: string },
  brand: EmailBrand,
) {
  const text = (value: string) =>
    value.replace(/BorderPay Africa|BorderPay/g, () => brand.brandName)
      .replaceAll("https://app.borderpayafrica.com", brand.appOrigin)
      .replaceAll(
        "support@borderpayafrica.com",
        brand.supportEmail || "support@borderpayafrica.com",
      );
  let html = rendered.html.replace(
    /BorderPay Africa|BorderPay/g,
    () => escapeBrand(brand.brandName),
  ).replaceAll("https://app.borderpayafrica.com", escapeBrand(brand.appOrigin))
    .replaceAll("#C7FF00", brand.primaryColor).replaceAll(
      "#c7ff00",
      brand.primaryColor,
    );
  if (brand.logoUrl) {
    html = html.replaceAll(defaultLogo, escapeBrand(brand.logoUrl));
  }
  if (brand.supportEmail) {
    html = html.replaceAll(
      "support@borderpayafrica.com",
      escapeBrand(brand.supportEmail),
    );
  }
  const footer = `<p style="font-size:12px;text-align:center">${
    escapeBrand(brand.legalName)
  } · <a href="${escapeBrand(brand.termsUrl)}">Terms</a> · <a href="${
    escapeBrand(brand.privacyUrl)
  }">Privacy</a></p>`;
  html = html.includes("</body>")
    ? html.replace("</body>", footer + "</body>")
    : html + footer;
  return {
    subject: text(rendered.subject),
    html,
    text: text(rendered.text) +
      `\n${brand.legalName}\nTerms: ${brand.termsUrl}\nPrivacy: ${brand.privacyUrl}`,
  };
}
