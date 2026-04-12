/**
 * BorderPay Africa — KYC Jobs Admin List
 * Fetches all user profiles with their KYC verification records.
 * No external API calls — reads directly from Supabase tables.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Query user_profiles
    const { data: profiles, error: dbError } = await supabase
      .from('user_profiles')
      .select('id, full_name, email, phone, country, kyc_status, kyc_level, kyc_verified_at, maplerad_status, maplerad_customer_id, account_status, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (dbError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch profiles: ' + dbError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Query kyc_verifications
    const { data: verifications } = await supabase
      .from('kyc_verifications')
      .select('user_id, job_id, provider, status, document_type, confidence_score, result_data, verification_id, photo_url, country_code, id_type, created_at, updated_at')
      .order('created_at', { ascending: false });

    // Group verifications by user_id
    const verByUser: Record<string, any[]> = {};
    if (verifications) {
      for (const v of verifications) {
        if (!verByUser[v.user_id]) verByUser[v.user_id] = [];
        verByUser[v.user_id].push(v);
      }
    }

    // Get auth emails for profiles that don't have email
    const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({
      perPage: 1000,
    });
    const emailMap: Record<string, string> = {};
    if (authUsers) {
      for (const au of authUsers) {
        emailMap[au.id] = au.email || '';
      }
    }

    // Build enriched jobs list
    const jobs = (profiles || []).map((profile: any) => {
      const userVerifications = verByUser[profile.id] || [];
      const email = profile.email || emailMap[profile.id] || '';
      const latestVerification = userVerifications[0] || null;

      return {
        user_id: profile.id,
        full_name: profile.full_name || 'Unknown',
        email,
        phone: profile.phone || '',
        country: profile.country || '',
        kyc_status: profile.kyc_status || 'pending',
        kyc_level: profile.kyc_level || 0,
        kyc_verified_at: profile.kyc_verified_at || null,
        maplerad_status: profile.maplerad_status || 'not_enrolled',
        account_status: profile.account_status || 'pending_kyc',
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        verifications: userVerifications.map((v: any) => ({
          job_id: v.job_id,
          provider: v.provider || 'youverify',
          status: v.status,
          document_type: v.document_type,
          confidence_score: v.confidence_score,
          result_code: v.result_data?.result_code || null,
          result_text: v.result_data?.result_text || null,
          verification_id: v.verification_id || v.result_data?.youverify_id || null,
          full_name: v.result_data?.full_name || null,
          id_type: v.id_type || v.result_data?.id_type || null,
          country: v.country_code || v.result_data?.country || null,
          created_at: v.created_at,
          updated_at: v.updated_at,
        })),
        verification_result: latestVerification ? {
          status: latestVerification.status,
          verification_id: latestVerification.verification_id || '',
          provider: latestVerification.provider || 'youverify',
        } : null,
      };
    });

    // Parse query params for filtering
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get('status');

    const filtered = statusFilter && statusFilter !== 'all'
      ? jobs.filter((j: any) => {
          if (statusFilter === 'verified') return ['verified', 'approved'].includes(j.kyc_status);
          if (statusFilter === 'failed') return ['failed', 'rejected'].includes(j.kyc_status);
          return j.kyc_status === statusFilter;
        })
      : jobs;

    const stats = {
      total: jobs.length,
      verified: jobs.filter((j: any) => ['verified', 'approved'].includes(j.kyc_status)).length,
      pending: jobs.filter((j: any) => j.kyc_status === 'pending').length,
      failed: jobs.filter((j: any) => j.kyc_status === 'failed' || j.kyc_status === 'rejected').length,
    };

    return new Response(
      JSON.stringify({ success: true, data: { jobs: filtered, stats } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
