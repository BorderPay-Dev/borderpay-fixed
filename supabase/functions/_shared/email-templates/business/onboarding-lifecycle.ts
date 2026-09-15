import { BORDERPAY_BRAND, escapeHtml, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface BusinessOnboardingLifecycleProps {
  company_name?: string;
  stage?: "day_1" | "day_3" | "day_7" | "day_21" | "day_30";
}

const COPY = {
  day_1: {
    subject: "Welcome to BorderPay — complete your business verification",
    heading: "Complete your business onboarding",
    message: "Your BorderPay business workspace is ready. Complete business verification to activate eligible wallets and receiving accounts.",
    action: "Continue verification",
  },
  day_3: {
    subject: "Reminder: complete your BorderPay business verification",
    heading: "Your verification is still incomplete",
    message: "Please continue your business verification. Your application remains available and no financial services are active yet.",
    action: "Continue verification",
  },
  day_7: {
    subject: "Action required: finish your BorderPay onboarding",
    heading: "Finish setting up your business account",
    message: "Your business verification has not been completed. Submit the requested company and ownership information to continue.",
    action: "Resume verification",
  },
  day_21: {
    subject: "Final onboarding warning for your BorderPay application",
    heading: "Complete verification before day 30",
    message: "Your incomplete application will be frozen on day 30 if verification is not started or completed. We retain the application record for security and compliance.",
    action: "Complete verification",
  },
  day_30: {
    subject: "Your incomplete BorderPay application has been frozen",
    heading: "Application access frozen",
    message: "Your application remained not started or incomplete for 30 days and has been frozen. The record was not deleted. Contact BorderPay Support if you want to resume onboarding.",
    action: "Contact support",
  },
} as const;

export function render(p: BusinessOnboardingLifecycleProps): RenderedEmail {
  const stage = p.stage && p.stage in COPY ? p.stage : "day_1";
  const copy = COPY[stage];
  const company = String(p.company_name || "Your business");
  const body = `
    <p style="margin:0 0 16px;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">Hello ${escapeHtml(company)},</p>
    <p style="margin:0;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">${escapeHtml(copy.message)}</p>`;

  return {
    subject: copy.subject,
    html: htmlLayout({
      preview: copy.message,
      heading: copy.heading,
      introText: "BorderPay business onboarding",
      body,
      ctaText: copy.action,
      ctaUrl: stage === "day_30" ? "mailto:support@borderpayafrica.com" : `${BORDERPAY_BRAND.appUrl}/?screen=kyc`,
    }),
    text: textLayout({
      heading: copy.heading,
      body: `Hello ${company},\n\n${copy.message}`,
      ctaText: copy.action,
      ctaUrl: stage === "day_30" ? "mailto:support@borderpayafrica.com" : `${BORDERPAY_BRAND.appUrl}/?screen=kyc`,
    }),
  };
}
