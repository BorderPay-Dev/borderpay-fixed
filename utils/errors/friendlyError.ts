/**
 * BorderPay — Friendly Error Messages
 * Converts raw technical errors into user-friendly messages.
 *
 * Two jobs:
 *  1. Map known technical errors → calm, actionable copy.
 *  2. NEVER leak internals to users. Anything that names an infrastructure
 *     partner, provider, processor, or reads like raw
 *     backend jargon (customer_id, endorsement, kyc_link, enum, RPC names,
 *     HTTP codes, stack traces) is replaced by the fallback. BorderPay is
 *     white-label: the user must only ever see BorderPay, never a provider.
 */

const ERROR_MAP: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /unable\s+to\s+(connect|reach)\s+.*servers?|servers?\s+(are\s+)?not\s+connected|not\s+connected\s+this\s+time|our\s+servers.*not\s+connected/i, message: 'Connection error. Please check your internet and try again.' },
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
const FORBIDDEN = /\b(bridge|yellow\s*card|yellowcard|stripe|youverify|persona|plaid|resend|provider|processor|partner|verification vendor|mail vendor|database|supabase|postgres|postgrest|deno|webhook|edge function|rpc|enum|kyc_link|kyb|bvn|sql|constraint|null value|undefined|stack|traceback|payload|deployment_id|referenceerror|navperftrackcache|arrowright)\b/i;

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
