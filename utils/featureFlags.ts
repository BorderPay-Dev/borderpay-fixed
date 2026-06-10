/**
 * Frontend feature flags.
 *
 * These are local boolean constants compiled into the SPA bundle. They are
 * NOT a runtime config service and do NOT read from any backend env var
 * directly — that is intentional, so partner-readable strings ("Transfers
 * activating soon", etc.) ship and disappear atomically with a commit.
 *
 * Lockstep contract with the backend
 * -----------------------------------
 * `TRANSFERS_LIVE` mirrors the server-side `BRIDGE_TRANSFERS_ENABLED`
 * env var on the deployed `bridge-transfer` edge function. When the
 * backend flag flips to true, this constant must flip to true in the
 * same release. If the constant is true but the backend env is still
 * false, users see the Send flow load and then hit a generic error
 * from the gated `bridge-transfer` call (the worst-of-both state we
 * are explicitly avoiding here).
 *
 * Flip procedure when transfers are ready:
 *   1. Set the backend env var: BRIDGE_TRANSFERS_ENABLED=true on the
 *      bridge-transfer function (via Supabase project settings or
 *      `supabase functions deploy`).
 *   2. In the SAME release PR, flip this constant to `true`.
 *   3. Merge. SPA + edge stay aligned.
 *
 * Reverse procedure on rollback:
 *   1. Flip this constant to `false` (frontend ships within ~15 s of
 *      merge via Vercel auto-deploy).
 *   2. Set backend env var BRIDGE_TRANSFERS_ENABLED=false (effective
 *      immediately).
 */

/**
 * Whether outbound transfers (Send Money flow) are live for end users.
 *
 * - false: Send entry points (bottom-nav, drawer, dashboard CTAs) route
 *          to <TransfersComingSoonScreen /> instead of <SendMoneyFlow />.
 *          Frontend never calls `bridge-transfer` or its lookup chain
 *          (`get-account-rails`, `resolve-account`, etc.).
 * - true:  Existing SendMoneyFlow renders normally.
 */
export const TRANSFERS_LIVE: boolean = true;

/**
 * Whether Bridge onboarding (customer creation + KYC/KYB hosted-link start)
 * is live for end users.
 *
 * - false: dashboard KYC/KYB entry points render a paused state and the
 *          Bridge onboarding edge functions fail closed before any provider
 *          call.
 * - true:  existing KYC/KYB start flows render normally.
 *
 * Keep this in lockstep with the server-side `BRIDGE_ONBOARDING_ENABLED`
 * gate on the Bridge onboarding functions.
 */
export const BRIDGE_ONBOARDING_LIVE: boolean = true;

/**
 * Whether the Bridge external-accounts (payout destinations) feature is
 * live for end users.
 *
 * - false: the "Payout accounts" drawer item is hidden and the
 *          external-accounts routes render nothing. Frontend never calls
 *          the `bridge-external-account` edge function.
 * - true:  the Add / List external-account screens are reachable.
 *
 * Default OFF. Flip to true only after ALL of these are done in the
 * SAME release:
 *   1. Migration `20260529_bridge_external_accounts.sql` applied
 *      (creates public.bridge_external_accounts + RLS).
 *   2. `bridge-external-account` edge function deployed (verify_jwt=true).
 *   3. `BRIDGE_API_KEY` function secret confirmed present.
 *   4. A sandbox smoke proving create/list/delete round-trips.
 *
 * Like TRANSFERS_LIVE, this is a compile-time constant, not a runtime
 * config service — the UI ships/disappears atomically with a commit.
 */
export const EXTERNAL_ACCOUNTS_LIVE: boolean = true;

/**
 * Whether the gate-1 activation PAYMENT can actually be collected in-app.
 *
 * The activation funnel is: pay one-time fee → email (payment confirmation +
 * KYC link) → verify ID → accounts provision via Bridge webhooks. Gate-1
 * payment must be collected by an EXTERNAL gateway (Flutterwave / Stripe),
 * because a brand-new user has no funded virtual account to debit.
 *
 * - false: every activation / upgrade CTA shows <ActivationComingSoon/> so
 *          new users never hit the VA-debit modal that can't serve a first
 *          activation. (Current state — gateway pending account approval.)
 * - true:  the real checkout flow renders (UpgradeModal / hosted checkout).
 *
 * Flip to true in the SAME release that wires the approved gateway's
 * checkout → webhook → mark-paid → fire payment+KYC email.
 */
export const ACTIVATION_GATEWAY_LIVE: boolean = true;
