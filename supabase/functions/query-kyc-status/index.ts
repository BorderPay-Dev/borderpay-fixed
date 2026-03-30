import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function generateSmileSignature(partnerId: string, apiKey: string, timestamp: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const data = encoder.encode(timestamp + partnerId + 'sid_request');
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return base64Encode(new Uint8Array(sig));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── POST: register a pending KYC job ──────────────────────────────────────
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const { job_id } = body;

      if (!job_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'job_id required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await supabase.from('kyc_verifications').upsert({
        user_id: user.id,
        job_id,
        provider: 'smileid',
        status: 'pending',
        document_type: 'smile_link',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── GET: query current KYC status (SmileID API + DB) ─────────────────────

    // Check if already verified in DB
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('kyc_status')
      .eq('id', user.id)
      .single();

    if (profile?.kyc_status === 'verified') {
      return new Response(
        JSON.stringify({ success: true, status: 'verified' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Look up latest pending job for this user
    const { data: verification } = await supabase
      .from('kyc_verifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!verification?.job_id) {
      return new Response(
        JSON.stringify({ success: true, status: profile?.kyc_status || 'not_started' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If already resolved in DB, return that
    if (verification.status === 'approved' || verification.status === 'verified') {
      return new Response(
        JSON.stringify({ success: true, status: 'verified' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (verification.status === 'failed' || verification.status === 'rejected') {
      return new Response(
        JSON.stringify({ success: true, status: 'failed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Query SmileID API
    const partnerId = Deno.env.get('SMILEID_PARTNER_ID') || Deno.env.get('SMILE_PARTNER_ID') || '';
    const apiKey = Deno.env.get('SMILEID_API_KEY') || Deno.env.get('SMILE_API_KEY') || '';
    const env = Deno.env.get('SMILEID_ENVIRONMENT') || Deno.env.get('SMILE_ENV') || 'sandbox';
    const apiBase = env === 'production'
      ? 'https://api.smileidentity.com'
      : 'https://testapi.smileidentity.com';

    if (!partnerId || !apiKey) {
      return new Response(
        JSON.stringify({ success: true, status: 'pending' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const timestamp = new Date().toISOString();
    const signature = await generateSmileSignature(partnerId, apiKey, timestamp);

    const smileRes = await fetch(`${apiBase}/v1/job_status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partner_id: partnerId,
        timestamp,
        signature,
        user_id: user.id,
        job_id: verification.job_id,
        image_links: false,
        history: false,
      }),
    });

    if (!smileRes.ok) {
      // Job not found yet on SmileID (still in progress or not started)
      return new Response(
        JSON.stringify({ success: true, status: 'pending' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const smileData = await smileRes.json();

    if (!smileData.job_complete) {
      return new Response(
        JSON.stringify({ success: true, status: 'pending' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Job complete — determine pass/fail
    const resultCode = smileData.result?.ResultCode || smileData.code || '';
    // SmileID result codes: 0810 = Approved, 0811 = Approved with ID Authority error, 1020 = ID not found, etc.
    const passed = smileData.job_success === true;
    const newStatus = passed ? 'verified' : 'failed';

    // Update kyc_verifications
    await supabase.from('kyc_verifications').update({
      status: passed ? 'approved' : 'rejected',
      confidence_score: smileData.result?.ConfidenceValue
        ? parseFloat(smileData.result.ConfidenceValue)
        : null,
      result_data: {
        result_code: resultCode,
        result_text: smileData.result?.ResultText,
        confidence_score: smileData.result?.ConfidenceValue,
        smile_job_id: smileData.result?.SmileJobID,
        full_name: smileData.result?.FullName,
        id_type: smileData.result?.IDType,
        country: smileData.result?.Country,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .eq('job_id', verification.job_id);

    // Update user_profiles
    await supabase.from('user_profiles').update({
      kyc_status: newStatus,
      kyc_level: passed ? 2 : 0,
      kyc_verified_at: passed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);

    return new Response(
      JSON.stringify({ success: true, status: newStatus }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
