-- Plan-key remap to the one-time activation model (#A3) — SOURCE ONLY, NOT APPLIED.
--
-- Monthly subscription tiers are removed. Any existing user_subscriptions rows
-- on the old paid tiers are remapped to the single activated tier for their
-- account type; free starters are unchanged. Apply only as a gated step.

UPDATE public.user_subscriptions
   SET plan_key = 'individual_activated'
 WHERE plan_key IN ('individual_premium');

UPDATE public.user_subscriptions
   SET plan_key = 'business_activated'
 WHERE plan_key IN ('business_growth', 'business_enterprise');

-- Free defaults stay as-is:
--   individual_starter, business_starter  → unchanged (view-only, not activated)
