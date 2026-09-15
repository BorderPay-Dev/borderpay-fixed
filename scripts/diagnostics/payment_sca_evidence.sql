-- Read-only evidence review. Never infer historical SCA from a later fix.
-- Run against the linked production database after verifying the target.
select
  t.bridge_transfer_id,
  t.created_at,
  t.status,
  b.country as incorporation_country,
  t.metadata->>'sca_required' as sca_required,
  t.metadata->>'sca_attestation_outcome' as submitted_outcome,
  t.metadata->>'sca_authorization_id' as authorization_id,
  a.verified_factors,
  a.created_at as authorized_at,
  a.consumed_at,
  a.payload_hash,
  case
    when a.id is null then 'missing_authorization_record'
    when a.consumed_at is null then 'authorization_not_consumed'
    when not (a.verified_factors @> array['pin','totp']::text[]) then 'missing_factors'
    when t.metadata->>'sca_attestation_outcome' is distinct from 'sca_used' then 'missing_submitted_attestation'
    else 'local_evidence_present_verify_with_bridge'
  end as evidence_status
from public.transactions t
join public.business_profiles b on b.user_id = t.user_id
left join public.sca_authorizations a
  on a.id::text = t.metadata->>'sca_authorization_id'
 and a.user_id = t.user_id
where t.provider::text = 'bridge'
  and t.created_at >= now() - interval '30 days'
  and (t.metadata->>'direction' = 'debit' or t.metadata->>'transaction_type' = 'withdrawal')
  and upper(trim(b.country)) = any(array[
    'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE',
    'IT','LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE',
    'AUT','BEL','BGR','HRV','CYP','CZE','DNK','EST','FIN','FRA','DEU','GRC',
    'HUN','ISL','IRL','ITA','LVA','LIE','LTU','LUX','MLT','NLD','NOR','POL',
    'PRT','ROU','SVK','SVN','ESP','SWE'
  ])
order by t.created_at desc;
