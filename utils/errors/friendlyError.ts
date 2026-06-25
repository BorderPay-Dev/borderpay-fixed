/**
 * BorderPay — Friendly Error Messages
 * Converts raw technical errors into user-friendly messages.
 *
 * Two jobs:
 *  1. Map known technical errors → calm, actionable copy.
 *  2. NEVER leak internals to users. Anything that names an infrastructure
 *     partner (Bridge, Flutterwave, Stripe, …) or reads like raw
 *     backend jargon (customer_id, endorsement, kyc_link, enum, RPC names,
 *     HTTP codes, stack traces) is replaced by the fallback. BorderPay is
 *     white-label: the user must only ever see BorderPay, never a provider.
 */

const ERROR_MAP: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /failed to fetch|networkerror|net::err|econnrefused|load failed/i, message: 'Connection error. Please check your internet and try again.' },
  { pattern: /timeout|timed out|aborted/i, message: 'Request timed out. Please try again.' },
  { pattern: /401|unauthorized|invalid.*token|jwt.*expired/i, message: 'Session expired. Please log in again.' },
  { pattern: /403|forbidden/i, message: 'You don\'t have permission to do this.' },
  { pattern: /404|not found/i, message: 'The requested resource was not found.' },
  { pattern: /429|too many|rate limit/i, message: 'Too many requests. Please wait a moment and try again.' },
  { pattern: /500|internal server/i, message: 'Something went wrong on our end. Please try again later.' },
  { pattern: /502|503|bad gateway|service unavailable/i, message: 'Service temporarily unavailable. Please try again shortly.' },
  { pattern: /email.*already|duplicate.*email|already.*registered/i, message: 'This email is already registered. Try logging in instead.' },
  { pattern: /invalid.*email/i, message: 'Please enter a valid email address.' },
  { pattern: /invalid.*password|wrong.*password|incorrect.*password/i, message: 'Incorrect password. Please try again.' },
  { pattern: /password.*short|password.*least/i, message: 'Password is too short. Use at least 12 characters.' },
  { pattern: /insufficient.*funds|insufficient.*balance/i, message: 'Insufficient balance for this transaction.' },
  { pattern: /kyc.*required|verification.*required|not.*verified|not_verified/i, message: 'Identity verification required. Verify your ID to continue.' },
  // Provisioning/onboarding gaps — phrased for the user, partner-free.
  { pattern: /no .*customer|customer .*(not|n't) (found|exist|provision)|customer_id|not_started|onboarding/i, message: 'Finish verifying your identity to use this feature.' },
  { pattern: /endorsement|not .*available .*region|unsupported.*region|nexus/i, message: 'This service isn\'t available for your region yet.' },
  { pattern: /virtual account|wallet .*(not|n't)|not provisioned|no account/i, message: 'This account isn\'t ready yet. Please try again shortly.' },
  { pattern: /can't find variable|is not defined|referenceerror/i, message: 'Something went wrong. Please refresh and try again.' },
];

/**
 * Words that must NEVER appear in user-facing copy. If a raw error mentions any
 * of these, we drop the raw text entirely and return the safe fallback — the
 * message is partner/infrastructure detail, not something a user should read.
 */
const FORBIDDEN = /\b(bridge|flutterwave|stripe|youverify|persona|plaid|resend|supabase|postgres|postgrest|deno|webhook|edge function|rpc|enum|kyc_link|kyb|bvn|sql|constraint|null value|undefined|stack|traceback|payload|deployment_id|referenceerror|navperftrackcache|arrowright)\b/i;

/**
 * Convert a raw error into a user-friendly message.
 * Order: known mappings → forbidden-internals scrub → technical-shape scrub →
 * otherwise assume the string is already user-safe copy.
 */
export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const raw = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : (error as any)?.error || (error as any)?.message || '';

  if (!raw) return fallback;

  // 1. Known, mappable technical errors → friendly copy.
  for (const { pattern, message } of ERROR_MAP) {
    if (pattern.test(raw)) return message;
  }

  // 2. Mentions a partner or raw backend jargon → never leak it.
  if (FORBIDDEN.test(raw)) return fallback;

  // 3. Looks technical (HTTP codes, stack traces, IDs, code-y punctuation) → fallback.
  if (/^\d{3}\b|at\s+\w+\s*\(|Error:|Exception|[{}<>]|https?:\/\/|[a-f0-9]{8}-[a-f0-9]{4}|_[a-z]+_|::/i.test(raw)) {
    return fallback;
  }

  // 4. Overly long blobs are almost never real user copy.
  if (raw.length > 160) return fallback;

  // 5. Otherwise the error is probably already user-friendly.
  return raw;
}

export type ErrorContext =
  | 'signup'
  | 'signin'
  | 'kyc'
  | 'fx'
  | 'wallet'
  | 'notifications'
  | 'default';

const CONTEXTUAL_PATTERNS: Record<ErrorContext, Array<{ pattern: RegExp; message: string }>> = {
  signup: [
    { pattern: /email.*already|duplicate.*email|already.*registered|user already registered/i, message: 'An account with this email already exists. Please sign in instead.' },
    { pattern: /password.*short|password.*least|weak password|password should/i, message: 'Your password does not meet the security requirements. Please choose a stronger password.' },
    { pattern: /invalid.*email|email.*invalid/i, message: 'Please enter a valid email address.' },
    { pattern: /verify.*email|email.*confirm|email not confirmed/i, message: "We've sent a verification email. Please check your inbox before signing in." },
    { pattern: /timeout|timed out|failed to fetch|networkerror|net::err|unable to connect/i, message: "We couldn't reach our servers. Please check your internet connection and try again." },
  ],
  signin: [
    { pattern: /invalid login credentials|wrong.*password|incorrect.*password|invalid.*password/i, message: 'Incorrect email or password.' },
    { pattern: /email not confirmed|not confirmed|verify.*email/i, message: 'Please verify your email before signing in.' },
    { pattern: /disabled|suspended|blocked|restricted/i, message: 'Your account has been temporarily restricted. Please contact support.' },
  ],
  kyc: [
    { pattern: /expired|kyc.*link.*expired|session.*expired/i, message: 'Your identity verification session has expired. Tap below to generate a new verification link.' },
    { pattern: /not_started|onboarding|creating customer|customer.*not found/i, message: "We're preparing your identity verification. Please try again in a few moments." },
    { pattern: /failed to fetch|networkerror|net::err|unable to connect|timeout|timed out/i, message: "We're unable to start verification at the moment. Please try again later." },
  ],
  fx: [
    { pattern: /no wallets available|no wallet|wallet.*not found/i, message: "You don't have any wallets with available balances to convert. Add funds to a wallet before starting an FX conversion." },
    { pattern: /no external accounts available|external account.*not found/i, message: "You haven't added an external account yet. Add an external account to send funds." },
  ],
  wallet: [
    { pattern: /failed to load wallets|wallet.*load/i, message: "We're having trouble loading your wallets. Pull to refresh or try again." },
  ],
  notifications: [
    { pattern: /failed|load|timeout|network|fetch/i, message: "Notifications couldn't be loaded right now." },
  ],
  default: [],
};

export function friendlyErrorFor(
  error: unknown,
  context: ErrorContext,
  fallback = 'Something went wrong. Please try again.',
): string {
  const raw = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : (error as any)?.error || (error as any)?.message || '';

  if (raw) {
    const rules = CONTEXTUAL_PATTERNS[context] || [];
    for (const { pattern, message } of rules) {
      if (pattern.test(raw)) return message;
    }
  }

  return friendlyError(error, fallback);
}
