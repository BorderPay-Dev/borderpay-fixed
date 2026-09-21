export const BANKING_TRANSITION_ACTIVE = {
  "subject": "October update: USD receiving accounts in your business name",
  "preview": "Planned for October 2026: broader USD access for BorderPay businesses.",
  "heading": "More ways to receive business payments this October",
  "intro": "In October 2026, we plan to introduce new banking infrastructure and expand access to USD receiving accounts in your business’s legal name—including for eligible businesses that do not currently have USD access.",
  "continuity": "You will continue using your existing BorderPay business account and sign-in details. We will notify you when the new services are ready for your business.",
  "items": [
    {
      "title": "USD accounts in your business name",
      "text": "Our planned rollout will let eligible businesses receive USD payments using account details bearing their verified business legal name. Availability depends on verification, approval and account activation."
    },
    {
      "title": "Keep using your active accounts",
      "text": "Continue using the receiving details shown as active in BorderPay. Do not use details marked deactivated. Update your invoices and customer instructions only after your new receiving accounts are confirmed active."
    },
    {
      "title": "Any steps needed",
      "text": "We will let you know if your business needs to confirm company information or provide updated documents before activating the new accounts."
    },
    {
      "title": "Existing funds and payments",
      "text": "The rollout does not automatically transfer existing balances or resolve pending payments, refunds or reviews. We will provide separate instructions where needed."
    }
  ],
  "closing": "We are preparing this upgrade to support more dependable day-to-day business payments, with a familiar BorderPay experience.",
  "support": "If you need help with an existing payment, reply to your current support ticket so we can keep your case history together.",
  "cta": "Open BorderPay",
  "url": "https://app.borderpayafrica.com"
} as const;

export const BANKING_TRANSITION_RESTRICTED = {
  "subject": "October update: a new review path for your business",
  "preview": "An update for businesses whose receiving services or applications are restricted.",
  "heading": "A new path for your business this October",
  "intro": "In October 2026, we plan to introduce an alternative business onboarding and review path as part of our banking infrastructure upgrade.",
  "continuity": "You can keep your existing BorderPay sign-in. We will contact you when the new review path is available for your business and explain the steps to take.",
  "items": [
    {
      "title": "A separate business review",
      "text": "Access to new receiving accounts will depend on the applicable verification and approval requirements. You may need to confirm your company details and provide updated supporting documents."
    },
    {
      "title": "Wait for confirmed activation",
      "text": "Do not ask buyers to pay to receiving details marked paused, frozen or deactivated. Only share new bank details after BorderPay confirms that the accounts are active."
    },
    {
      "title": "Existing funds and payments",
      "text": "The new review path does not automatically lift current restrictions, release held funds, transfer existing balances or resolve pending payments, refunds or reviews. These cases will continue to be handled separately."
    }
  ],
  "closing": "Our aim is to give your business a clearer way forward. This announcement does not mean that a new account has already been approved.",
  "support": "If you need help with an existing payment, reply to your current support ticket so we can keep your case history together.",
  "cta": "Open BorderPay",
  "url": "https://app.borderpayafrica.com"
} as const;

export const BANKING_TRANSITION_STATUS_MESSAGES = {
  "rejected": "Your previous business application was not approved. The planned October path will allow your business to undergo a separate review; the previous decision is not automatically reversed.",
  "frozen": "Your account is currently marked frozen. The planned October review path offers a possible route to new receiving services, subject to approval; it does not remove the current freeze.",
  "paused": "Your receiving services are currently paused or inactive. We will explain how to access the planned October review path when it is available.",
  "suspended": "Your account is currently suspended. The planned October review path does not restore access automatically; we will explain the review requirements when available.",
  "offboarded": "Your previous receiving services are closed or offboarded. The planned October path involves a separate application review and does not reactivate those previous services."
} as const;
