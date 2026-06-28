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

function normalizeBridgeVerificationStatus(
  bridgeCustomerId: string | null | undefined,
  rawStatus: string | null | undefined,
): 'not_started' | 'pending' | 'under_review' | 'approved' | 'rejected' {
  if (!bridgeCustomerId) return 'not_started';
  const s = String(rawStatus || '').trim().toLowerCase();
  if (!s) return 'not_started';
  if (s === 'approved' || s === 'active' || s === 'verified' || s === 'authorized' || s === 'completed' || s === 'complete') return 'approved';
  if (s === 'rejected' || s === 'failed' || s === 'denied') return 'rejected';
  if (s === 'under_review' || s === 'in_review' || s === 'review') return 'under_review';
  if (s === 'pending' || s === 'submitted') return 'pending';
  return 'not_started';
}

function mapUiStatus(
  normalized: 'not_started' | 'pending' | 'under_review' | 'approved' | 'rejected',
): 'none' | 'draft' | 'under_review' | 'approved' | 'rejected' {
  if (normalized === 'approved') return 'approved';
  if (normalized === 'rejected') return 'rejected';
  if (normalized === 'under_review') return 'under_review';
  if (normalized === 'pending') return 'draft';
  return 'none';
}

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

    // Bridge is the sole verification authority. Legacy submission rows are
    // intentionally excluded from active status derivation.
    const [{ data: profile }, { data: biz }] = await Promise.all([
      supabase.from('user_profiles')
        .select('account_type, bridge_customer_id, bridge_kyc_status, bridge_account_status, bridge_kyc_completed_at')
        .eq('id', user.id)
        .maybeSingle(),
      supabase.from('business_profiles')
        .select('bridge_kyb_status, bridge_kyb_completed_at')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    const isBusiness = profile?.account_type === 'business';
    const bridgeStatusRaw = isBusiness
      ? (biz?.bridge_kyb_status ?? null)
      : (profile?.bridge_kyc_status ?? profile?.bridge_account_status ?? null);
    const normalizedBridgeStatus = normalizeBridgeVerificationStatus(
      profile?.bridge_customer_id ?? null,
      bridgeStatusRaw,
    );
    const status = mapUiStatus(normalizedBridgeStatus);
    const submittedAt = isBusiness
      ? (biz?.bridge_kyb_completed_at || null)
      : (profile?.bridge_kyc_completed_at || null);

    return new Response(JSON.stringify({
      success: true,
      provider: 'bridge',
      status,
      rejection_reason:    null,
      submitted_at:        submittedAt,
      account_type:        profile?.account_type ?? 'individual',
      bridge_customer_id:  profile?.bridge_customer_id || null,
      bridge_kyc_status:   normalizedBridgeStatus, // compatibility field
      bridge_kyb_status:   isBusiness ? normalizedBridgeStatus : null,
      bridge_verification_status: normalizedBridgeStatus,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('kyc-status failed', err);
    return new Response(JSON.stringify({
      success: false,
      code: 'verification_status_unavailable',
      error: 'Unable to load verification status right now. Please try again shortly.',
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
