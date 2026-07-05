import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

interface Props {
  full_name?: string;
  reason_public?: string;
  support_url?: string;
  action_url?: string;
}

export function render(props: Props = {}): RenderedEmail {
  const fullName = String(props.full_name || "").trim() || "there";
  const reasonPublic = String(props.reason_public || "Your account is temporarily restricted while we complete a review.").trim();
  const supportUrl = String(props.support_url || "https://app.borderpayafrica.com/settings/support").trim();
  const actionUrl = String(props.action_url || "https://app.borderpayafrica.com").trim();
  const subject = "BorderPay account temporarily restricted";
  const heading = "Your account is temporarily restricted";
  const introText = `Hi ${fullName}, some account actions are paused while we complete a review.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      ${escapeHtml(reasonPublic)}
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      Our team is reviewing your account status. We’ll notify you as soon as this is resolved.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      If you need help now, contact support: <a href="${escapeHtml(supportUrl)}" style="color:${BORDERPAY_BRAND.accent};text-decoration:underline;">Contact support</a>.
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
        `Hi ${fullName}, some account actions are paused while we complete a review.\n\n` +
        `${reasonPublic}\n\n` +
        "Our team is reviewing your account status and will notify you once resolved.",
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

