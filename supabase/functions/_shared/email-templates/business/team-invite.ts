import { htmlLayout, textLayout, escapeHtml, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface BusinessTeamInviteProps {
  company_name?: string;
  inviter_name?: string;
  role?: "admin" | "member" | "viewer" | string;
  invite_url: string;
  expires_in_days?: number;
}

const ROLE_COPY: Record<string, string> = {
  admin: "manage team members and operate the business workspace",
  member: "send, receive, and work inside the business workspace",
  viewer: "view business activity and account information",
};

export function render(p: BusinessTeamInviteProps): RenderedEmail {
  const company = p.company_name || "a business";
  const inviter = p.inviter_name || "A business admin";
  const role = String(p.role || "member").toLowerCase();
  const ttl = Number(p.expires_in_days || 7);
  const roleCopy = ROLE_COPY[role] || "access the business workspace";
  const subject = `${inviter} invited you to ${company} on BorderPay`;
  const heading = "You're invited to a business workspace";
  const introText = `${inviter} invited you to join ${company} on BorderPay Africa.`;
  const body = `
    <p style="margin:0 0 14px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Accept this invite using the email address that received it. Once accepted, you'll be able to ${escapeHtml(roleCopy)} according to your assigned role.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background:${BORDERPAY_BRAND.bg};border:1px solid ${BORDERPAY_BRAND.border};border-radius:8px;">
      <tr>
        <td style="padding:14px 16px;font-size:13px;color:${BORDERPAY_BRAND.textMuted};line-height:1.6;">
          <strong style="color:${BORDERPAY_BRAND.text};">Business</strong><br />
          ${escapeHtml(company)}
        </td>
      </tr>
      <tr>
        <td style="padding:0 16px 14px;font-size:13px;color:${BORDERPAY_BRAND.textMuted};line-height:1.6;">
          <strong style="color:${BORDERPAY_BRAND.text};">Role</strong><br />
          ${escapeHtml(role.charAt(0).toUpperCase() + role.slice(1))}
        </td>
      </tr>
    </table>
    <p style="margin:14px 0 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;line-height:1.6;text-align:center;">
      This invite expires in <strong style="color:${BORDERPAY_BRAND.text};">${ttl} day${ttl === 1 ? "" : "s"}</strong>.
    </p>
    <p style="margin:18px 0 0;font-size:12px;color:${BORDERPAY_BRAND.textFaint};text-align:center;line-height:1.5;">
      Trouble with the button? Copy and paste this link:
    </p>
    <p style="margin:6px 0 0;font-size:11px;color:${BORDERPAY_BRAND.success};text-align:center;word-break:break-all;line-height:1.4;">
      ${escapeHtml(p.invite_url)}
    </p>`;
  const footerNote = `If you were not expecting this invitation, you can ignore this email.`;

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body,
      ctaText: "Accept invite",
      ctaUrl: p.invite_url,
      footerNote,
    }),
    text: textLayout({
      heading,
      body: `${inviter} invited you to join ${company} on BorderPay Africa as ${role}. Accept with the same email address that received this invite. The invite expires in ${ttl} day${ttl === 1 ? "" : "s"}.`,
      ctaText: "Accept invite",
      ctaUrl: p.invite_url,
      footerNote,
    }),
  };
}
