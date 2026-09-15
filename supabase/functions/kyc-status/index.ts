/**
 * BorderPay Africa — KYC Status
 *
 * Returns the current KYC status for the authenticated caller.
 * Used by the frontend to poll while a submission is under review.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ success: false, error: 'Missing Authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Provider-neutral KYC status surface. Reads Bridge KYC/KYB from the
    // canonical fields; the legacy `kyc_submissions` row may still exist
    // for users who went through the previous-provider flow, so we still
    // derive a coarse status from it when present.
    const [{ data: sub }, { data: profile }, { data: biz }] = await Promise.all([
      supabase.from('kyc_submissions')
        .select('submission_status, rejection_reason, submitted_at, updated_at, country, id_type')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase.from('user_profiles')
        .select('kyc_status, account_type, account_status, bridge_account_status, bridge_customer_id, bridge_kyc_status')
        .eq('id', user.id)
        .maybeSingle(),
      supabase.from('business_profiles')
        .select('bridge_kyb_status')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    const bridgeStatus =
      profile?.account_type === 'business'
        ? (biz?.bridge_kyb_status ?? null)
        : (profile?.bridge_kyc_status ?? null);

    const isBusiness = profile?.account_type === 'business';
    const bridgeAccountStatus = String(profile?.bridge_account_status || '').toLowerCase();
    const normalizedBridgeStatus = String(bridgeStatus || '').toLowerCase();
    const restartableBusinessVerification = isBusiness && (
      ['incomplete', 'awaiting_ubo', 'needs_ubos'].includes(bridgeAccountStatus)
      || ['incomplete', 'awaiting_ubo', 'needs_ubos'].includes(normalizedBridgeStatus)
    );
    let status: 'none' | 'draft' | 'needs_ubos' | 'awaiting_rfi' | 'needs_edd' | 'under_review' | 'approved' | 'rejected' = 'none';
    // Released native clients restart incomplete/ownership-required business
    // verification through the ToS-first path. Raw provider truth remains in
    // the dedicated provider fields for operations and lifecycle automation.
    if (restartableBusinessVerification) status = 'draft';
    else if (['awaiting_ubo', 'needs_ubos'].includes(bridgeAccountStatus) || ['awaiting_ubo', 'needs_ubos'].includes(String(bridgeStatus))) status = 'needs_ubos';
    else if (['awaiting_questionnaire', 'awaiting_rfi'].includes(bridgeAccountStatus) || ['awaiting_questionnaire', 'awaiting_rfi'].includes(String(bridgeStatus))) status = 'awaiting_rfi';
    else if (['deposits_restricted', 'needs_edd'].includes(bridgeAccountStatus) || ['deposits_restricted', 'needs_edd'].includes(String(bridgeStatus))) status = 'needs_edd';
    else if (bridgeStatus === 'rejected' || (!isBusiness && sub?.submission_status === 'rejected')) status = 'rejected';
    else if (bridgeStatus === 'approved' || (!isBusiness && (profile?.kyc_status === 'verified' || sub?.submission_status === 'approved'))) status = 'approved';
    else if (bridgeStatus === 'under_review' || (!isBusiness && sub?.submission_status === 'under_review')) status = 'under_review';
    else if (bridgeStatus === 'pending' || bridgeStatus === 'incomplete' || bridgeStatus === 'not_started' || (!isBusiness && sub?.submission_status === 'draft')) status = 'draft';

    return new Response(JSON.stringify({
      success: true,
      status,
      rejection_reason:    sub?.rejection_reason || null,
      submitted_at:        sub?.submitted_at || null,
      account_type:        profile?.account_type ?? 'individual',
      bridge_customer_id:  profile?.bridge_customer_id || null,
      bridge_kyc_status:   restartableBusinessVerification ? 'not_started' : bridgeStatus,
      bridge_account_status: restartableBusinessVerification ? 'not_started' : (bridgeAccountStatus || null),
      bridge_provider_account_status: bridgeAccountStatus || null,
      bridge_provider_kyc_status: bridgeStatus,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
