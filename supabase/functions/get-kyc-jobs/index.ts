import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── SmileID HMAC-SHA256 signature ─────────────────────────────────────────────
async function generateSmileSignature(
  partnerId: string,
  apiKey: string,
  timestamp: string
): Promise<string> {
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

// ── Fetch single job status from SmileID ──────────────────────────────────────
async function fetchSmileJobStatus(
  partnerId: string,
  apiKey: string,
  apiBase: string,
  userId: string,
  jobId: string
): Promise<any> {
  const timestamp = new Date().toISOString();
  const signature = await generateSmileSignature(partnerId, apiKey, timestamp);

  const response = await fetch(`${apiBase}/v1/job_status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      partner_id: partnerId,
      timestamp,
      signature,
      user_id: userId,
      job_id: jobId,
      image_links: false,
      history: false,
    }),
  });

  if (!response.ok) return null;
  return response.json();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Auth check
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

    // SmileID config from env
    const partnerId = Deno.env.get('SMILE_PARTNER_ID') || '';
    const apiKey = Deno.env.get('SMILE_API_KEY') || '';
    const env = Deno.env.get('SMILE_ENV') || 'sandbox';
    const apiBase = env === 'live'
      ? 'https://api.smileidentity.com'
      : 'https://testapi.smileidentity.com';

    // Query all profiles with KYC data
    const { data: profiles, error: dbError } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, country, kyc_status, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (dbError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch profiles' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Query KYC documents to get SmileID provider refs
    const { data: kycDocs } = await supabase
      .from('kyc_documents')
      .select('user_id, document_type, status, provider_ref, rejection_reason, created_at, updated_at')
      .order('created_at', { ascending: false });

    // Group docs by user_id
    const docsByUser: Record<string, any[]> = {};
    if (kycDocs) {
      for (const doc of kycDocs) {
        if (!docsByUser[doc.user_id]) docsByUser[doc.user_id] = [];
        docsByUser[doc.user_id].push(doc);
      }
    }

    // Get auth emails for profiles (profiles table may not have email)
    const userIds = (profiles || []).map((p: any) => p.id);
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
    const jobs = await Promise.all(
      (profiles || []).map(async (profile: any) => {
        const docs = docsByUser[profile.id] || [];
        const email = profile.email || emailMap[profile.id] || '';

        // If we have SmileID config and a provider_ref, try to get live status
        let smileStatus = null;
        if (partnerId && apiKey) {
          const docWithRef = docs.find((d: any) => d.provider_ref);
          if (docWithRef) {
            try {
              smileStatus = await fetchSmileJobStatus(
                partnerId, apiKey, apiBase, profile.id, docWithRef.provider_ref
              );
            } catch { /* silent — use DB status */ }
          }
        }

        return {
          user_id: profile.id,
          full_name: profile.full_name || 'Unknown',
          email,
          phone: profile.phone || '',
          country: profile.country || '',
          kyc_status: profile.kyc_status || 'pending',
          created_at: profile.created_at,
          updated_at: profile.updated_at,
          documents: docs.map((d: any) => ({
            document_type: d.document_type,
            status: d.status,
            provider_ref: d.provider_ref,
            rejection_reason: d.rejection_reason,
            created_at: d.created_at,
          })),
          smile_job: smileStatus ? {
            job_complete: smileStatus.job_complete,
            job_success: smileStatus.job_success,
            result_code: smileStatus.result?.ResultCode || smileStatus.code,
            result_text: smileStatus.result?.ResultText,
            confidence: smileStatus.result?.ConfidenceValue,
            smile_job_id: smileStatus.result?.SmileJobID,
          } : null,
        };
      })
    );

    // Parse query params for filtering
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get('status'); // pending | verified | failed | all

    const filtered = statusFilter && statusFilter !== 'all'
      ? jobs.filter((j: any) => j.kyc_status === statusFilter)
      : jobs;

    // Stats
    const stats = {
      total: jobs.length,
      verified: jobs.filter((j: any) => ['verified', 'approved', 'tier2', 'full_enrollment'].includes(j.kyc_status)).length,
      pending: jobs.filter((j: any) => j.kyc_status === 'pending').length,
      failed: jobs.filter((j: any) => j.kyc_status === 'failed' || j.kyc_status === 'rejected').length,
    };

    return new Response(
      JSON.stringify({ success: true, data: { jobs: filtered, stats } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
