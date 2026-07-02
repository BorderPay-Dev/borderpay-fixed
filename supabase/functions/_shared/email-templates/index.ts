/**
 * Email template registry — single source of truth for every transactional
 * email BorderPay sends. Each template exports a `render(props)` function
 * returning `{ subject, html, text }`.
 *
 * Add a new template:
 *   1. create file under individual/ or business/
 *   2. import + register here
 *   3. add the slug to the TemplateName union
 */

import { RenderedEmail } from "./layout.ts";

import { render as individualEmailVerification }     from "./individual/email-verification.ts";
import { render as individualPasswordReset }          from "./individual/password-reset.ts";
import { render as individualTransactionNotification }from "./individual/transaction-notification.ts";
import { render as individualKycDecision }            from "./individual/kyc-decision.ts";
import { render as individualAccountReady }           from "./individual/account-ready.ts";
import { render as individualVerificationAuthorized }  from "./individual/verification-authorized.ts";
import { render as individualPaymentReceived }         from "./individual/payment-received.ts";
import { render as individualPlatformLive }            from "./individual/platform-live.ts";
import { render as individualExternalAccountStatus }   from "./individual/external-account-status.ts";
import { render as individualFounderWelcome }          from "./individual/founder-welcome.ts";

import { render as businessEmailVerification }        from "./business/email-verification.ts";
import { render as businessKybSubmitted }             from "./business/kyb-submitted.ts";
import { render as businessKybDecision }              from "./business/kyb-decision.ts";
import { render as businessKybAdditionalDetails }     from "./business/kyb-additional-details.ts";
import { render as businessTransactionNotification }  from "./business/transaction-notification.ts";
import { render as businessAccountActivated }         from "./business/account-activated.ts";
import { render as businessAccountReady }             from "./business/account-ready.ts";
import { render as businessVerificationAuthorized }    from "./business/verification-authorized.ts";
import { render as businessPaymentReceived }           from "./business/payment-received.ts";
import { render as businessPlatformLive }              from "./business/platform-live.ts";
import { render as businessExternalAccountStatus }     from "./business/external-account-status.ts";
import { render as businessFounderWelcome }            from "./business/founder-welcome.ts";

export type TemplateName =
  | "individual.email_verification"
  | "individual.password_reset"
  | "individual.transaction_notification"
  | "individual.kyc_decision"
  | "individual.account_ready"
  | "individual.verification_authorized"
  | "individual.payment_received"
  | "individual.platform_live"
  | "individual.external_account_status"
  | "individual.founder_welcome"
  | "business.email_verification"
  | "business.kyb_submitted"
  | "business.kyb_decision"
  | "business.kyb_additional_details"
  | "business.transaction_notification"
  | "business.account_activated"
  | "business.account_ready"
  | "business.verification_authorized"
  | "business.payment_received"
  | "business.platform_live"
  | "business.external_account_status"
  | "business.founder_welcome";

type Renderer = (props: any) => RenderedEmail;

export const TEMPLATES: Record<TemplateName, Renderer> = {
  "individual.email_verification":      individualEmailVerification,
  "individual.password_reset":          individualPasswordReset,
  "individual.transaction_notification":individualTransactionNotification,
  "individual.kyc_decision":            individualKycDecision,
  "individual.account_ready":           individualAccountReady,
  "individual.verification_authorized": individualVerificationAuthorized,
  "individual.payment_received":        individualPaymentReceived,
  "individual.platform_live":           individualPlatformLive,
  "individual.external_account_status": individualExternalAccountStatus,
  "individual.founder_welcome":         individualFounderWelcome,
  "business.email_verification":        businessEmailVerification,
  "business.kyb_submitted":             businessKybSubmitted,
  "business.kyb_decision":              businessKybDecision,
  "business.kyb_additional_details":    businessKybAdditionalDetails,
  "business.transaction_notification":  businessTransactionNotification,
  "business.account_activated":         businessAccountActivated,
  "business.account_ready":             businessAccountReady,
  "business.verification_authorized":   businessVerificationAuthorized,
  "business.payment_received":          businessPaymentReceived,
  "business.platform_live":             businessPlatformLive,
  "business.external_account_status":   businessExternalAccountStatus,
  "business.founder_welcome":           businessFounderWelcome,
};

export function renderTemplate(name: TemplateName, props: any): RenderedEmail {
  const fn = TEMPLATES[name];
  if (!fn) throw new Error(`Unknown email template: ${name}`);
  return fn(props || {});
}
