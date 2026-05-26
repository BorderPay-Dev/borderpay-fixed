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
export const TRANSFERS_LIVE: boolean = false;
