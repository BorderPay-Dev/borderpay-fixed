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

    const [{ data: sub }, { data: profile }] = await Promise.all([
      supabase.from('kyc_submissions')
        .select('submission_status, rejection_reason, submitted_at, updated_at, maplerad_customer_id, country, id_type')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase.from('user_profiles')
        .select('kyc_status, maplerad_customer_id, account_status')
        .eq('id', user.id)
        .maybeSingle(),
    ]);

    let status: 'none' | 'draft' | 'under_review' | 'approved' | 'rejected' = 'none';
    if (profile?.kyc_status === 'verified' || sub?.submission_status === 'approved') status = 'approved';
    else if (sub?.submission_status === 'rejected') status = 'rejected';
    else if (sub?.submission_status === 'under_review') status = 'under_review';
    else if (sub?.submission_status === 'draft') status = 'draft';

    return new Response(JSON.stringify({
      success: true,
      status,
      rejection_reason: sub?.rejection_reason || null,
      submitted_at: sub?.submitted_at || null,
      maplerad_customer_id: sub?.maplerad_customer_id || profile?.maplerad_customer_id || null,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
