# Affiliate incoming-fee rewards

Verified active existing individual and business customers can join using their BorderPay identity. Only a referred Business qualifies, after approved KYB and an active Bridge account. Attribution is immutable, self-referrals and ambiguous codes are rejected, and new referrals carry no cash commission.

Each referral earns one sequential 30-day USD/EUR/GBP incoming-fee reward at 2.5%. Lower existing fees are preserved. `affiliate-reward-worker` reads Bridge virtual accounts, persists original fees before changing them, confirms provider readback before activating rewards, and restores original fees on expiry. The worker runs each minute with per-owner leases. Separate provider pricing changes are flagged rather than overwritten. New virtual accounts are picked up on the next synchronization; no existing payment endpoint is redeployed.

The portal exposes signup, verification, pending activation, active, queued, expired and revoked rewards. Realtime events, focus refresh and one-minute refresh keep rewards current. Emails and app copy describe reduced fees, not cash commissions or a misleading 30% discount.

## Yellow Card limitation

The requested target is 1.5% incoming markup. It is not advertised or activated in this release. Production Yellow Card Receive computes a fee quote but does not submit a customer-specific partner-fee override. Its published Receive API exposes partner fees in responses but not a fee override in the request schema. A provider-supported charging control is required before promising the reward. Existing Yellow Card and virtual-account production source differs from main; those handlers remain untouched.

## Deployment

Apply `20260917190000_affiliate_reward_lifecycle.sql`, deploy `affiliate-reward-worker`, `affiliate-sso-link` and `send-email`, then publish the affiliates portal. Migration is registered separately when applied using the database query API. The migration creates its cron job but does not create payment transactions or update provider fees itself. No native build is required for the portal; app copy ships in a later native build.

## Verification

- Deno lifecycle tests cover fee capture, confirmation, retries, expiry, lower fees, conflicts and email copy.
- SQL rollback assertions exercised attribution, qualification, duplicate events, provider-gated activation, two sequential windows, expired entitlement and individual member reporting against the production schema.
- Portal tests cover reward states; local Chrome checks cover mobile/desktop navigation, refresh, reward visibility and no misleading fee promotion.
