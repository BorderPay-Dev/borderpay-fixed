import { htmlLayout, textLayout, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

export interface IndividualGlobalAccountInstructionsProps {
  full_name?: string | null;
  currency: string;
  account_letter_attached?: boolean;
}

export function render(p: IndividualGlobalAccountInstructionsProps): RenderedEmail {
  const name = firstName(p.full_name);
  const currency = String(p.currency || "USD").toUpperCase();
  const attached = p.account_letter_attached !== false;
  const subject = `${currency} global account instructions`;
  const heading = "Your account instructions are ready";
  const introText = `Hi ${name}, your ${currency} account instructions are ready to share with clients or marketplaces.`;

  const body = `
    <p style="margin:0 0 14px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      ${attached ? "Your account instructions letter is attached to this email." : "Open BorderPay to view your account details."}
      Use the exact account holder name, routing details, and account number shown in BorderPay or on the account letter.
    </p>
    <div style="background:${BORDERPAY_BRAND.bg};border:1px solid ${BORDERPAY_BRAND.border};padding:14px 16px;border-radius:6px;margin:14px 0;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.55;">
      <strong>Important:</strong> If a marketplace asks for proof of account ownership, upload the attached account letter together with your ACH/FedNow routing and account details.
    </div>
    <p style="margin:14px 0 0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      Do not edit the account letter or change the account holder name when submitting it to a marketplace.
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
      ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${attached ? "Your account instructions letter is attached to this email." : "Open BorderPay to view your account details."} Use the exact account holder name, routing details, and account number shown in BorderPay or on the account letter.\n\nIf a marketplace asks for proof of account ownership, upload the account letter together with your ACH/FedNow routing and account details.\n\nDo not edit the account letter or change the account holder name when submitting it to a marketplace.`,
      ctaText: "Open BorderPay",
      ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
  };
}
