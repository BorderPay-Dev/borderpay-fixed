-- Restore actionable KYB states from the authoritative Bridge customer status.
-- Some older webhook projections collapsed these states into under_review.

update public.business_profiles as business
set bridge_kyb_status = case lower(profile.bridge_account_status)
      when 'awaiting_ubo' then 'needs_ubos'
      when 'needs_ubos' then 'needs_ubos'
      when 'awaiting_questionnaire' then 'awaiting_rfi'
      when 'awaiting_rfi' then 'awaiting_rfi'
      when 'deposits_restricted' then 'needs_edd'
      when 'needs_edd' then 'needs_edd'
      else business.bridge_kyb_status
    end,
    updated_at = now()
from public.user_profiles as profile
where profile.id = business.user_id
  and lower(coalesce(profile.account_type::text, '')) = 'business'
  and lower(coalesce(profile.bridge_account_status, '')) in (
    'awaiting_ubo', 'needs_ubos', 'awaiting_questionnaire',
    'awaiting_rfi', 'deposits_restricted', 'needs_edd'
  )
  and lower(coalesce(business.bridge_kyb_status, '')) is distinct from case lower(profile.bridge_account_status)
    when 'awaiting_ubo' then 'needs_ubos'
    when 'needs_ubos' then 'needs_ubos'
    when 'awaiting_questionnaire' then 'awaiting_rfi'
    when 'awaiting_rfi' then 'awaiting_rfi'
    when 'deposits_restricted' then 'needs_edd'
    when 'needs_edd' then 'needs_edd'
    else lower(coalesce(business.bridge_kyb_status, ''))
  end;
