import { BORDERPAY_BRAND, escapeHtml, htmlLayout, RenderedEmail, textLayout } from "../layout.ts";

export interface PartnerAccessInviteProps {
  invite_url: string;
  existing_account?: boolean;
}

export function render(props: PartnerAccessInviteProps): RenderedEmail {
  if (!props.invite_url) throw new Error("invite_url required");
  const existing = props.existing_account === true;
  const subject = "Your BorderPay Partner Portal invitation";
  const heading = "Your partner access is approved";
  const introText = existing
    ? "Use the secure link below to open the BorderPay Partner Portal with your existing account."
    : "Use the secure link below to create your partner password and begin due diligence.";
  const body = `
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      This invitation is only for the business email address that received it. Partner access remains sandbox-only until BorderPay completes KYB, commercial, compliance, and security review.
    </p>
    <p style="margin:18px 0 0;font-size:12px;color:${BORDERPAY_BRAND.textFaint};text-align:center;line-height:1.5;">
      Trouble with the button? Copy and paste this secure link:
    </p>
    <p style="margin:6px 0 0;font-size:11px;color:${BORDERPAY_BRAND.success};text-align:center;word-break:break-all;line-height:1.4;">
      ${escapeHtml(props.invite_url)}
    </p>`;
  const footerNote = "If you did not request partner access, ignore this email and contact BorderPay Support.";
  return {
    subject,
    html: htmlLayout({ preview: subject, heading, introText, body, ctaText: "Open secure partner portal", ctaUrl: props.invite_url, footerNote }),
    text: textLayout({ heading, body: `${introText} Partner access remains sandbox-only until BorderPay completes its reviews.`, ctaText: "Open secure partner portal", ctaUrl: props.invite_url, footerNote }),
  };
}
