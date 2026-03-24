/**
 * BorderPay — Friendly Error Messages
 * Converts raw technical errors into user-friendly messages.
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
  { pattern: /kyc.*required|verification.*required|not.*verified/i, message: 'Identity verification required. Complete KYC to continue.' },
];

/**
 * Convert a raw error into a user-friendly message.
 * If the error is already friendly (doesn't match technical patterns), returns it as-is.
 */
export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const raw = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : (error as any)?.error || (error as any)?.message || '';

  if (!raw) return fallback;

  for (const { pattern, message } of ERROR_MAP) {
    if (pattern.test(raw)) return message;
  }

  // If the message looks technical (contains HTTP codes, stack traces, etc.), use fallback
  if (/^\d{3}\b|at\s+\w+\s*\(|Error:|Exception/i.test(raw)) {
    return fallback;
  }

  // Otherwise the error is probably already user-friendly
  return raw;
}
