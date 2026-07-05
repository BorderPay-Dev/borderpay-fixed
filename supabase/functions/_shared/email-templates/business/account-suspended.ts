import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

interface Props {
  company_name?: string;
  full_name?: string;
  reason_public?: string;
  support_url?: string;
  action_url?: string;
}

export function render(props: Props = {}): RenderedEmail {
  const companyName = String(props.company_name || "").trim() || "your business account";
  const fullName = String(props.full_name || "").trim();
  const reasonPublic = String(props.reason_public || "Your business account is temporarily restricted while we complete a review.").trim();
  const supportUrl = String(props.support_url || "https://app.borderpayafrica.com/settings/support").trim();
  const actionUrl = String(props.action_url || "https://app.borderpayafrica.com").trim();
  const greeting = fullName ? `Hi ${fullName},` : "Hi there,";
  const subject = "BorderPay business account temporarily restricted";
  const heading = "Your business account is temporarily restricted";
  const introText = `${greeting} some actions on ${companyName} are paused while we complete a review.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      ${escapeHtml(reasonPublic)}
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      Our team is reviewing your business account status. We’ll notify you as soon as this is resolved.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      If your team needs assistance now, contact support: <a href="${escapeHtml(supportUrl)}" style="color:${BORDERPAY_BRAND.accent};text-decoration:underline;">Contact support</a>.
    </p>
  `;

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body,
      ctaText: "Open BorderPay",
      ctaUrl: actionUrl,
      brandTone: "warning",
    }),
    text: textLayout({
      heading,
      body:
        `${greeting} some actions on ${companyName} are paused while we complete a review.\n\n` +
        `${reasonPublic}\n\n` +
        "Our team is reviewing your business account status and will notify you once resolved.",
      ctaText: "Open BorderPay",
      ctaUrl: actionUrl,
      footerNote: `Contact support: ${supportUrl}`,
    }),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

