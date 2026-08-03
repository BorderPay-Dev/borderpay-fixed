/**
 * Shared email layout — mobile-responsive, Gmail-safe, table-based.
 *
 * Inline styles only (Gmail/Outlook strip <style> tags from <head>).
 * Brand must remain visible even when Gmail blocks remote images.
 */

export const BORDERPAY_BRAND = {
  bg:        "#F4F6F5",
  card:      "#FFFFFF",
  header:    "#000000",
  border:    "#D8DED8",
  accent:    "#C7FF00",
  accent2:   "#C7FF00",
  text:      "#111513",
  textMuted: "#425049",
  textFaint: "#6B756F",
  headerText:"#F3F7FA",
  danger:    "#B42318",
  success:   "#067647",
  warning:   "#B54708",
  appUrl:    "https://app.borderpayafrica.com",
  supportEmail: "support@borderpayafrica.com",
  heroUrl:   "https://orwrcpwsffjlvzuraxjc.supabase.co/storage/v1/object/public/email-logo.png/assets/borderpay-email-logo.png",
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
  surface?:    "default" | "clean";
}

export function htmlLayout(p: LayoutProps): string {
  const b           = BORDERPAY_BRAND;
  const cleanSurface = p.surface === "clean";
  const canvasColor = cleanSurface ? "#FFFFFF" : b.bg;
  const cardColor = "#FFFFFF";
  const headerColor = cleanSurface ? "#FFFFFF" : b.header;
  const headerTextColor = cleanSurface ? b.text : b.headerText;
  const brandWordColor = cleanSurface ? b.text : b.accent;
  const toneColor = p.brandTone === "danger" ? b.danger : p.brandTone === "warning" ? b.warning : b.accent;
  const cta = p.ctaText && p.ctaUrl
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
         <tr><td align="center">
           <a href="${escapeHtml(p.ctaUrl)}" target="_blank" style="display:inline-block;padding:14px 34px;background-color:${b.accent};color:#000000;font-size:15px;font-weight:700;text-decoration:none;border-radius:8px;">${escapeHtml(p.ctaText)}</a>
         </td></tr>
       </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" style="margin:0;padding:0;background-color:${canvasColor};">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(p.heading)}</title>
<style>body, table, td { margin:0; padding:0; } a { color:${b.success}; }</style>
</head>
<body class="body" style="margin:0;padding:0;background-color:${canvasColor};font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:${b.text};">
${p.preview ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${canvasColor};">${escapeHtml(p.preview)}</div>` : ""}
<!-- Full-bleed wrapper. -->
<table role="presentation" class="bp-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${canvasColor}" style="background-color:${canvasColor};">
  <tr>
    <td align="center" bgcolor="${canvasColor}" style="background-color:${canvasColor};padding:36px 16px;">
      <table role="presentation" class="bp-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${cardColor}" style="max-width:560px;background-color:${cardColor};border:1px solid ${b.border};overflow:hidden;">
        <tr><td bgcolor="${toneColor}" style="height:4px;background-color:${toneColor};line-height:4px;font-size:4px;">&nbsp;</td></tr>
        <tr>
          <td bgcolor="${headerColor}" style="background-color:${headerColor};padding:24px 30px;border-bottom:1px solid ${b.border};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="left" valign="middle" style="width:178px;">
                  <img
                    src="${escapeHtml(b.heroUrl)}"
                    width="160"
                    alt="BorderPay Africa"
                    style="display:block;width:160px;max-width:160px;height:auto;border:0;outline:none;text-decoration:none;color:${headerTextColor};font-size:18px;font-weight:700;"
                  />
                </td>
                <td align="right" valign="middle" style="font-size:13px;line-height:18px;color:${headerTextColor};font-weight:700;letter-spacing:0;text-align:right;">
                  <span style="color:${brandWordColor};">BorderPay</span> Africa
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="${cardColor}" style="background-color:${cardColor};padding:30px 32px 28px;">
            <h1 class="bp-text" style="margin:0 0 14px;font-size:23px;font-weight:700;color:${b.text};text-align:center;line-height:1.3;">${escapeHtml(p.heading)}</h1>
            ${p.introText ? `<p class="bp-muted" style="margin:0 0 20px;font-size:15px;color:${b.textMuted};text-align:center;line-height:1.65;">${escapeHtml(p.introText)}</p>` : ""}
            <div class="bp-muted" style="font-size:15px;color:${b.textMuted};line-height:1.65;">${p.body}</div>
            ${cta}
            ${p.footerNote ? `<p class="bp-faint" style="margin:18px 0 0;font-size:12px;color:${b.textFaint};text-align:center;line-height:1.5;">${p.footerNote}</p>` : ""}
          </td>
        </tr>
        <tr><td style="padding:0 32px;"><div style="height:1px;background-color:${b.border};line-height:1px;font-size:1px;">&nbsp;</div></td></tr>
        <tr>
          <td bgcolor="${cardColor}" style="background-color:${cardColor};padding:20px 32px 32px;">
            <p class="bp-faint" style="margin:0;font-size:12px;color:${b.textFaint};text-align:center;line-height:1.5;">
              Need help? Email <a href="mailto:${b.supportEmail}" style="color:${b.success};text-decoration:none;">${b.supportEmail}</a>
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

export function fmtReceiptMoney(amount: number, currency: string): string {
  const n = Number(amount);
  const code = String(currency || "").toUpperCase();
  if (!Number.isFinite(n)) return `${amount} ${code}`.trim();
  const symbol = code === "GBP" ? "£" : code === "EUR" ? "€" : ["USD", "USDC", "USDT"].includes(code) ? "$" : "";
  return `${symbol}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`.trim();
}

export function firstName(full?: string | null): string {
  return ((full || "").trim().split(/\s+/)[0]) || "there";
}
