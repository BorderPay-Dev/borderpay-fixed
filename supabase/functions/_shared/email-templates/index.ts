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
import { render as individualPinResetLink }          from "./individual/pin-reset-link.ts";
import { render as individualTransactionNotification }from "./individual/transaction-notification.ts";
import { render as individualKycDecision }            from "./individual/kyc-decision.ts";
import { render as individualAccountReady }           from "./individual/account-ready.ts";
import { render as individualVerificationAuthorized }  from "./individual/verification-authorized.ts";
import { render as individualPaymentReceived }         from "./individual/payment-received.ts";

import { render as businessEmailVerification }        from "./business/email-verification.ts";
import { render as businessPinResetLink }            from "./business/pin-reset-link.ts";
import { render as businessKybSubmitted }             from "./business/kyb-submitted.ts";
import { render as businessKybDecision }              from "./business/kyb-decision.ts";
import { render as businessTransactionNotification }  from "./business/transaction-notification.ts";
import { render as businessAccountActivated }         from "./business/account-activated.ts";
import { render as businessAccountReady }             from "./business/account-ready.ts";
import { render as businessVerificationAuthorized }    from "./business/verification-authorized.ts";
import { render as businessVerificationReminder }      from "./business/verification-reminder.ts";
import { render as businessPaymentReceived }           from "./business/payment-received.ts";

export type TemplateName =
  | "individual.email_verification"
  | "individual.password_reset"
  | "individual.pin_reset_link"
  | "individual.transaction_notification"
  | "individual.kyc_decision"
  | "individual.account_ready"
  | "individual.verification_authorized"
  | "individual.payment_received"
  | "business.email_verification"
  | "business.pin_reset_link"
  | "business.kyb_submitted"
  | "business.kyb_decision"
  | "business.transaction_notification"
  | "business.account_activated"
  | "business.account_ready"
  | "business.verification_authorized"
  | "business.verification_reminder"
  | "business.payment_received";

type Renderer = (props: any) => RenderedEmail;

export const TEMPLATES: Record<TemplateName, Renderer> = {
  "individual.email_verification":      individualEmailVerification,
  "individual.password_reset":          individualPasswordReset,
  "individual.pin_reset_link":          individualPinResetLink,
  "individual.transaction_notification":individualTransactionNotification,
  "individual.kyc_decision":            individualKycDecision,
  "individual.account_ready":           individualAccountReady,
  "individual.verification_authorized": individualVerificationAuthorized,
  "individual.payment_received":        individualPaymentReceived,
  "business.email_verification":        businessEmailVerification,
  "business.pin_reset_link":            businessPinResetLink,
  "business.kyb_submitted":             businessKybSubmitted,
  "business.kyb_decision":              businessKybDecision,
  "business.transaction_notification":  businessTransactionNotification,
  "business.account_activated":         businessAccountActivated,
  "business.account_ready":             businessAccountReady,
  "business.verification_authorized":   businessVerificationAuthorized,
  "business.verification_reminder":     businessVerificationReminder,
  "business.payment_received":          businessPaymentReceived,
};

export function renderTemplate(name: TemplateName, props: any): RenderedEmail {
  const fn = TEMPLATES[name];
  if (!fn) throw new Error(`Unknown email template: ${name}`);
  return fn(props || {});
}
