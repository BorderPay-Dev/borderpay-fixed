/**
 * Shared email layout — mobile-responsive, dark-theme, table-based.
 *
 * Inline styles only (Gmail/Outlook strip <style> tags from <head>).
 * Hero branding is rendered inline (no remote image dependency).
 */

export const BORDERPAY_BRAND = {
  bg:        "#0B0E11",
  card:      "#11161D",
  border:    "#26313A",
  accent:    "#C7FF00",
  accent2:   "#9CD400",
  text:      "#F3F7FA",
  textMuted: "#B7C2CC",
  textFaint: "#8D99A5",
  danger:    "#FF5A5A",
  success:   "#2FD06E",
  warning:   "#E8A923",
  appUrl:    "https://app.borderpayafrica.com",
  supportEmail: "support@borderpayafrica.com",
  heroUrl:   "https://orwrcpwsffjlvzuraxjc.supabase.co/storage/v1/object/public/email-logo.png/assets/borderpay-white-logo-email.png",
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
           <a href="${escapeHtml(p.ctaUrl)}" target="_blank" style="display:inline-block;padding:14px 36px;background-color:${b.accent};color:#000000;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;letter-spacing:0.3px;">${escapeHtml(p.ctaText)}</a>
         </td></tr>
       </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" style="margin:0;padding:0;background-color:${b.bg};">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(p.heading)}</title>
<style>body, table, td { margin:0; padding:0; } a { color:${b.accent}; }</style>
</head>
<body class="body" style="margin:0;padding:0;background-color:${b.bg};font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:${b.text};">
${p.preview ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${b.bg};">${escapeHtml(p.preview)}</div>` : ""}
<!-- Full-bleed wrapper. -->
<table role="presentation" class="bp-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${b.bg}" style="background-color:${b.bg};">
  <tr>
    <td align="center" bgcolor="${b.bg}" style="background-color:${b.bg};padding:36px 16px;">
      <table role="presentation" class="bp-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${b.card}" style="max-width:540px;background-color:${b.card};border-radius:18px;border:1px solid ${b.border};overflow:hidden;box-shadow:0 10px 32px rgba(0,0,0,0.35);">
        <tr><td style="height:4px;background:${accentBar};line-height:4px;font-size:4px;">&nbsp;</td></tr>
        <tr>
          <td align="center" style="padding:0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(160deg,#121a22 0%,#0b0f14 100%);">
              <tr>
                <td style="padding:22px 28px 16px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background:#05070A;border:1px solid #1D2630;border-radius:12px;padding:10px 14px;">
                        <img
                          src="${escapeHtml(b.heroUrl)}"
                          width="210"
                          alt="BorderPay Africa"
                          style="display:block;width:210px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;"
                        />
                      </td>
                    </tr>
                  </table>
                  <p style="margin:8px 0 0;font-size:12px;line-height:1.45;color:#9FB0BD;">
                    Global wallets, payments, and verification in one app.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="${b.card}" style="background-color:${b.card};padding:8px 32px 28px;">
            <h1 class="bp-text" style="margin:0 0 14px;font-size:23px;font-weight:700;color:${b.text};text-align:center;line-height:1.3;">${escapeHtml(p.heading)}</h1>
            ${p.introText ? `<p class="bp-muted" style="margin:0 0 20px;font-size:15px;color:${b.textMuted};text-align:center;line-height:1.65;">${escapeHtml(p.introText)}</p>` : ""}
            <div class="bp-muted" style="font-size:15px;color:${b.textMuted};line-height:1.65;">${p.body}</div>
            ${cta}
            ${p.footerNote ? `<p class="bp-faint" style="margin:18px 0 0;font-size:12px;color:${b.textFaint};text-align:center;line-height:1.5;">${p.footerNote}</p>` : ""}
          </td>
        </tr>
        <tr><td style="padding:0 32px;"><div style="height:1px;background-color:${b.border};line-height:1px;font-size:1px;">&nbsp;</div></td></tr>
        <tr>
          <td bgcolor="${b.card}" style="background-color:${b.card};padding:20px 32px 32px;">
            <p class="bp-faint" style="margin:0;font-size:12px;color:${b.textFaint};text-align:center;line-height:1.5;">
              Need help? Email <a href="mailto:${b.supportEmail}" style="color:${b.accent};text-decoration:none;">${b.supportEmail}</a>
            </p>
            <p class="bp-faint" style="margin:8px 0 0;font-size:12px;color:${b.textFaint};text-align:center;">
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
