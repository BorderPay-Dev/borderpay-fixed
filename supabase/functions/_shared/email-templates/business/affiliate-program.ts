import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface BusinessAffiliateProgramProps {
  company_name?: string;
  affiliate_url?: string;
}

export function render(p: BusinessAffiliateProgramProps): RenderedEmail {
  const company = String(p.company_name || "your business").trim();
  const affiliateUrl = String(p.affiliate_url || "https://affiliate.borderpayafrica.com");
  const subject = `${company}: BorderPay Affiliate Program`;
  const heading = "BorderPay Affiliate Program";
  const introText = `${company} can invite customers, partners, contractors, and business contacts to BorderPay and track rewards from the affiliate portal.`;

  const body = `
    <p style="margin:0 0 14px;color:#111111;font-size:14px;line-height:1.65;text-align:left;">
      The BorderPay Affiliate Program gives your business a trackable referral link, referral status, qualified-user count, earnings, payout progress, and card waitlist movement.
    </p>

    <div style="margin:0 0 16px;padding:14px;border:1px solid #D8DED8;border-radius:10px;background:#FFFFFF;text-align:left;">
      <div style="color:#111111;font-size:14px;font-weight:800;margin-bottom:8px;">How rewards qualify</div>
      <ol style="margin:0;padding-left:18px;color:#111111;font-size:13px;line-height:1.65;">
        <li>Share your business referral link from the affiliate portal.</li>
        <li>Your referral signs up with your link or referral code.</li>
        <li>Your referral completes verification.</li>
        <li>Your referral completes their first qualifying transaction.</li>
        <li>Your reward is added to your affiliate balance after the transaction clears.</li>
      </ol>
    </div>

    <div style="margin:0 0 16px;padding:14px;border:1px solid #D8DED8;border-radius:10px;background:#FFFFFF;text-align:left;">
      <div style="color:#111111;font-size:14px;font-weight:800;margin-bottom:8px;">Current affiliate levels</div>
      <ul style="margin:0;padding-left:18px;color:#111111;font-size:13px;line-height:1.65;">
        <li><strong style="color:#111111;">5 to 19 qualified users:</strong> $5 per user after their first qualifying transaction.</li>
        <li><strong style="color:#111111;">20 to 49 qualified users:</strong> $5 per user and Level 1 on-ramp fee reduction.</li>
        <li><strong style="color:#111111;">50 to 99 qualified users:</strong> $5 per user and a stronger on-ramp fee reduction.</li>
        <li><strong style="color:#111111;">100 to 499 qualified users:</strong> $10 per user and a stronger on-ramp fee reduction.</li>
        <li><strong style="color:#111111;">500+ qualified users:</strong> monthly partner rewards may apply after operator review.</li>
      </ul>
    </div>

    <div style="margin:0 0 16px;padding:14px;border:1px solid #D8DED8;border-radius:10px;background:#FFFFFF;text-align:left;">
      <div style="color:#111111;font-size:14px;font-weight:800;margin-bottom:8px;">Withdrawal rule</div>
      <p style="margin:0;color:#111111;font-size:13px;line-height:1.65;">
        Affiliate rewards become withdrawable when the available affiliate balance reaches $100. The portal shows the current balance, progress to $100, and payout history.
      </p>
    </div>

    <p style="margin:0;color:#111111;font-size:14px;line-height:1.65;text-align:left;">
      Rewards are tracked from BorderPay data and may be reviewed for duplicate accounts, self-referrals, suspicious activity, or incomplete transactions. If a referral was not tracked, contact support with the referral email before asking the user to create another account.
    </p>
  `;

  const textBody = [
    introText,
    "The BorderPay Affiliate Program gives your business a trackable referral link, referral status, qualified-user count, earnings, payout progress, and card waitlist movement.",
    "How rewards qualify:\n1. Share your business referral link from the affiliate portal.\n2. Your referral signs up with your link or referral code.\n3. Your referral completes verification.\n4. Your referral completes their first qualifying transaction.\n5. Your reward is added to your affiliate balance after the transaction clears.",
    "Current affiliate levels:\n5 to 19 qualified users: $5 per user after their first qualifying transaction.\n20 to 49 qualified users: $5 per user and Level 1 on-ramp fee reduction.\n50 to 99 qualified users: $5 per user and a stronger on-ramp fee reduction.\n100 to 499 qualified users: $10 per user and a stronger on-ramp fee reduction.\n500+ qualified users: monthly partner rewards may apply after operator review.",
    "Withdrawal rule: Affiliate rewards become withdrawable when the available affiliate balance reaches $100. The portal shows the current balance, progress to $100, and payout history.",
    "Rewards are tracked from BorderPay data and may be reviewed for duplicate accounts, self-referrals, suspicious activity, or incomplete transactions.",
  ].join("\n\n");

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body,
      ctaText: "Open affiliate portal",
      ctaUrl: affiliateUrl,
      footerNote: "For help with business referrals or payout tracking, reply to this email or contact BorderPay support.",
    }),
    text: textLayout({
      heading,
      body: textBody,
      ctaText: "Open affiliate portal",
      ctaUrl: affiliateUrl,
      footerNote: "For help with business referrals or payout tracking, reply to this email or contact BorderPay support.",
    }),
  };
}
