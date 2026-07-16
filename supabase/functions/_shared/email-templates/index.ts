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
import { render as individualTransactionStatus }      from "./individual/transaction-status.ts";
import { render as individualKycDecision }            from "./individual/kyc-decision.ts";
import { render as individualAccountReady }           from "./individual/account-ready.ts";
import { render as individualVerificationAuthorized }  from "./individual/verification-authorized.ts";
import { render as individualVerificationReminder }    from "./individual/verification-reminder.ts";
import { render as individualPaymentReceived }         from "./individual/payment-received.ts";
import { render as individualFounderWelcome }          from "./individual/founder-welcome.ts";
import { render as individualAccountSuspended }        from "./individual/account-suspended.ts";
import { render as individualRequestAccountReminder }  from "./individual/request-account-reminder.ts";

import { render as businessEmailVerification }        from "./business/email-verification.ts";
import { render as businessPinResetLink }            from "./business/pin-reset-link.ts";
import { render as businessKybSubmitted }             from "./business/kyb-submitted.ts";
import { render as businessKybDecision }              from "./business/kyb-decision.ts";
import { render as businessTransactionNotification }  from "./business/transaction-notification.ts";
import { render as businessTransactionStatus }        from "./business/transaction-status.ts";
import { render as businessAccountActivated }         from "./business/account-activated.ts";
import { render as businessAccountReady }             from "./business/account-ready.ts";
import { render as businessVerificationAuthorized }    from "./business/verification-authorized.ts";
import { render as businessVerificationReminder }      from "./business/verification-reminder.ts";
import { render as businessPaymentReceived }           from "./business/payment-received.ts";
import { render as businessFounderWelcome }            from "./business/founder-welcome.ts";
import { render as businessAccountSuspended }          from "./business/account-suspended.ts";
import { render as businessRequestAccountReminder }    from "./business/request-account-reminder.ts";

export type TemplateName =
  | "individual.email_verification"
  | "individual.password_reset"
  | "individual.pin_reset_link"
  | "individual.transaction_notification"
  | "individual.transaction_status"
  | "individual.kyc_decision"
  | "individual.account_ready"
  | "individual.verification_authorized"
  | "individual.verification_reminder"
  | "individual.payment_received"
  | "individual.founder_welcome"
  | "individual.account_suspended"
  | "individual.request_account_reminder"
  | "business.email_verification"
  | "business.pin_reset_link"
  | "business.kyb_submitted"
  | "business.kyb_decision"
  | "business.transaction_notification"
  | "business.transaction_status"
  | "business.account_activated"
  | "business.account_ready"
  | "business.verification_authorized"
  | "business.verification_reminder"
  | "business.payment_received"
  | "business.founder_welcome"
  | "business.account_suspended"
  | "business.request_account_reminder";

type Renderer = (props: any) => RenderedEmail;

export const TEMPLATES: Record<TemplateName, Renderer> = {
  "individual.email_verification":      individualEmailVerification,
  "individual.password_reset":          individualPasswordReset,
  "individual.pin_reset_link":          individualPinResetLink,
  "individual.transaction_notification":individualTransactionNotification,
  "individual.transaction_status":      individualTransactionStatus,
  "individual.kyc_decision":            individualKycDecision,
  "individual.account_ready":           individualAccountReady,
  "individual.verification_authorized": individualVerificationAuthorized,
  "individual.verification_reminder":   individualVerificationReminder,
  "individual.payment_received":        individualPaymentReceived,
  "individual.founder_welcome":         individualFounderWelcome,
  "individual.account_suspended":       individualAccountSuspended,
  "individual.request_account_reminder": individualRequestAccountReminder,
  "business.email_verification":        businessEmailVerification,
  "business.pin_reset_link":            businessPinResetLink,
  "business.kyb_submitted":             businessKybSubmitted,
  "business.kyb_decision":              businessKybDecision,
  "business.transaction_notification":  businessTransactionNotification,
  "business.transaction_status":        businessTransactionStatus,
  "business.account_activated":         businessAccountActivated,
  "business.account_ready":             businessAccountReady,
  "business.verification_authorized":   businessVerificationAuthorized,
  "business.verification_reminder":     businessVerificationReminder,
  "business.payment_received":          businessPaymentReceived,
  "business.founder_welcome":           businessFounderWelcome,
  "business.account_suspended":         businessAccountSuspended,
  "business.request_account_reminder":   businessRequestAccountReminder,
};

export function renderTemplate(name: TemplateName, props: any): RenderedEmail {
  const fn = TEMPLATES[name];
  if (!fn) throw new Error(`Unknown email template: ${name}`);
  return fn(props || {});
}
