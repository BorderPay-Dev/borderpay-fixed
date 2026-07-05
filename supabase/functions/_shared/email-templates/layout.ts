/**
 * Shared email layout — mobile-responsive, dark-theme, table-based.
 *
 * Inline styles only (Gmail/Outlook strip <style> tags from <head>).
 * Logo is pulled from a public bucket.
 */

export const BORDERPAY_BRAND = {
  bg:        "#000000",   // pure black — same on every client
  card:      "#000000",   // flat black (no card/bg mismatch under dark-mode inversion)
  border:    "#1F2937",   // solid hex (Outlook ignores rgba) — subtle hairline
  accent:    "#C7FF00",
  accent2:   "#9ECC00",
  text:      "#FFFFFF",
  textMuted: "#C2C7CF",   // lighter than before so it stays readable on pure black
  textFaint: "#8A9099",
  danger:    "#FF5A5A",
  success:   "#C7FF00",
  warning:   "#E8A923",
  appUrl:    "https://app.borderpayafrica.com",
  supportEmail: "support@borderpayafrica.com",
  logoUrl:   "https://orwrcpwsffjlvzuraxjc.supabase.co/storage/v1/object/public/email-logo.png/assets/borderpay-email-logod.png",
};

export interface RenderedEmail {
  subject: string;
  html:    string;
  text:    string;
}

interface LayoutProps {
  preview?:    string;
  heading:     string;
  introText?:  string;
  body:        string;       // inner HTML content
  ctaText?:    string;
  ctaUrl?:     string;
  footerNote?: string;
  brandTone?:  "default" | "danger" | "warning";
}

export function htmlLayout(p: LayoutProps): string {
  const b           = BORDERPAY_BRAND;
  const accentBar   = p.brandTone === "danger"  ? `linear-gradient(90deg, ${b.danger}, #d04444)`
                    : p.brandTone === "warning" ? `linear-gradient(90deg, ${b.warning}, #c4881d)`
                                                 : `linear-gradient(90deg, ${b.accent}, ${b.accent2})`;
  const cta = p.ctaText && p.ctaUrl
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
         <tr><td align="center">
           <a href="${escapeHtml(p.ctaUrl)}" target="_blank" style="display:inline-block;padding:14px 36px;background-color:${b.accent};color:${b.bg};font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;letter-spacing:0.3px;">${escapeHtml(p.ctaText)}</a>
         </td></tr>
       </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" style="margin:0;padding:0;background-color:${b.bg};">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<!-- Force ONE consistent (dark) palette on every client — Gmail / Outlook /
     Zoho / Apple Mail — so none of them re-theme or auto-invert the email. -->
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${escapeHtml(p.heading)}</title>
<style>
  :root { color-scheme: dark; supported-color-schemes: dark; }
  body, table, td { margin:0; padding:0; }
  a { color:${b.accent}; }
  /* Keep our palette under forced dark-mode color remapping (Gmail/Outlook.com). */
  u + .body, [data-ozark] { background:${b.bg} !important; }
  @media (prefers-color-scheme: light) {
    body, .bp-bg { background-color:${b.bg} !important; }
    .bp-text { color:${b.text} !important; }
  }
</style>
</head>
<body class="body" style="margin:0;padding:0;background-color:${b.bg};font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:${b.text};">
${p.preview ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${b.bg};">${escapeHtml(p.preview)}</div>` : ""}
<!-- Full-bleed black wrapper. bgcolor attr is what Outlook (Word engine) reads. -->
<table role="presentation" class="bp-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${b.bg}" style="background-color:${b.bg};">
  <tr>
    <td align="center" bgcolor="${b.bg}" style="background-color:${b.bg};padding:36px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${b.bg}" style="max-width:540px;background-color:${b.bg};border-radius:18px;border:1px solid ${b.border};overflow:hidden;">
        <tr><td style="height:4px;background:${accentBar};line-height:4px;font-size:4px;">&nbsp;</td></tr>
        <tr>
          <td align="center" bgcolor="${b.bg}" style="background-color:${b.bg};padding:40px 28px 20px;">
            <!-- Hero logo (keeps the 44:60 aspect ratio). -->
            <img src="${b.logoUrl}" alt="BorderPay Africa" width="104" height="142" style="display:block;border:0;outline:none;text-decoration:none;width:104px;height:142px;max-width:104px;" />
            <p class="bp-text" style="margin:18px 0 0;font-size:13px;font-weight:800;color:${b.text};letter-spacing:1.2px;text-transform:uppercase;">BorderPay Africa</p>
          </td>
        </tr>
        <tr>
          <td bgcolor="${b.bg}" style="background-color:${b.bg};padding:8px 32px 28px;">
            <h1 class="bp-text" style="margin:0 0 14px;font-size:23px;font-weight:700;color:${b.text};text-align:center;line-height:1.3;">${escapeHtml(p.heading)}</h1>
            ${p.introText ? `<p style="margin:0 0 20px;font-size:15px;color:${b.textMuted};text-align:center;line-height:1.65;">${escapeHtml(p.introText)}</p>` : ""}
            <div style="font-size:15px;color:${b.textMuted};line-height:1.65;">${p.body}</div>
            ${cta}
            ${p.footerNote ? `<p style="margin:18px 0 0;font-size:12px;color:${b.textFaint};text-align:center;line-height:1.5;">${p.footerNote}</p>` : ""}
          </td>
        </tr>
        <tr><td style="padding:0 32px;"><div style="height:1px;background-color:${b.border};line-height:1px;font-size:1px;">&nbsp;</div></td></tr>
        <tr>
          <td bgcolor="${b.bg}" style="background-color:${b.bg};padding:20px 32px 32px;">
            <p style="margin:0;font-size:12px;color:${b.textFaint};text-align:center;line-height:1.5;">
              Need help? Email <a href="mailto:${b.supportEmail}" style="color:${b.accent};text-decoration:none;">${b.supportEmail}</a>
            </p>
            <p style="margin:8px 0 0;font-size:12px;color:${b.textFaint};text-align:center;">
              &copy; ${new Date().getFullYear()} BorderPay Africa. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function textLayout(p: { heading: string; body: string; ctaText?: string; ctaUrl?: string; footerNote?: string }): string {
  const cta  = p.ctaText && p.ctaUrl ? `\n\n${p.ctaText}: ${p.ctaUrl}\n` : "";
  const note = p.footerNote ? `\n\n${stripTags(p.footerNote)}` : "";
  return `${p.heading}\n\n${stripTags(p.body)}${cta}${note}\n\n— BorderPay Africa\n${BORDERPAY_BRAND.appUrl}`;
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function fmtMoney(amount: number, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency.toUpperCase()}`;
}

export function firstName(full?: string | null): string {
  return ((full || "").trim().split(/\s+/)[0]) || "there";
}
