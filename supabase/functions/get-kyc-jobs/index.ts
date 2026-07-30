/**
 * BorderPay Africa — KYC Jobs Admin List (Bridge-neutral)
 * Fetches all user profiles with their KYC verification records.
 * No external API calls — reads directly from Supabase tables.
 *
 * Provider neutrality:
 *   • The active provider is Bridge. Older `kyc_verifications` rows may
 *     have a legacy-provider value in their `provider` column. We surface
 *     that column verbatim and do NOT default to any legacy provider when
 *     the column is null; the active provider for any new verification is
 *     'bridge'.
 *   • Bridge-native fields (`bridge_customer_id`, `bridge_kyc_status`,
 *     `business_profiles.bridge_kyb_status`) are the primary KYC signal in
 *     the response.
 *   • A `legacy_verifications` block exposes any pre-Bridge submission
 *     data for ops/audit context, with no legacy-provider-branded field
 *     names in the response.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function maskIdNumber(value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const compact = s.replace(/\s+/g, '');
  if (compact.length <= 4) return '*'.repeat(compact.length);
  return `${'*'.repeat(Math.max(4, Math.min(8, compact.length - 4)))}${compact.slice(-4)}`;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

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

    // ── user_profiles (provider-neutral fields only) ───────────────────
    const { data: profiles, error: dbError } = await supabase
      .from('user_profiles')
      .select('id, full_name, email, phone, country, account_type, kyc_status, kyc_level, kyc_verified_at, bridge_customer_id, bridge_kyc_status, account_status, date_of_birth, id_number, id_type, bridge_identity_metadata, bridge_identity_synced_at, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (dbError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch profiles: ' + dbError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── business_profiles (KYB status for business users) ─────────────
    const { data: businesses } = await supabase
      .from('business_profiles')
      .select('user_id, bridge_kyb_status, bridge_kyb_completed_at, company_name, registration_number, bridge_identity_metadata, bridge_identity_synced_at');
    const kybByUser: Record<string, any> = {};
    for (const b of (businesses || [])) {
      kybByUser[(b as any).user_id] = b;
    }

    // ── kyc_verifications (historical jobs from the legacy submission flow).
    // We pull provider verbatim — no legacy default — and surface the
    // submission as `legacy_verification` so the admin UI can show audit
    // history without re-branding it.
    const { data: verifications } = await supabase
      .from('kyc_verifications')
      .select('user_id, job_id, provider, status, document_type, confidence_score, result_data, verification_id, photo_url, country_code, id_type, created_at, updated_at')
      .order('created_at', { ascending: false });

    const verByUser: Record<string, any[]> = {};
    for (const v of (verifications || [])) {
      const uid = (v as any).user_id;
      if (!verByUser[uid]) verByUser[uid] = [];
      verByUser[uid].push(v);
    }

    // ── Auth email backfill ─────────────────────────────────────────────
    const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({
      perPage: 1000,
    });
    const emailMap: Record<string, string> = {};
    for (const au of (authUsers || [])) {
      emailMap[au.id] = au.email || '';
    }

    // ── Build enriched jobs list ───────────────────────────────────────
    const jobs = (profiles || []).map((profile: any) => {
      const userVerifications = verByUser[profile.id] || [];
      const email             = profile.email || emailMap[profile.id] || '';
      const latestLegacy      = userVerifications[0] || null;
      const isBusiness        = profile.account_type === 'business';
      const biz               = kybByUser[profile.id] || null;
      const bridgeReviewStatus = isBusiness ? (biz?.bridge_kyb_status ?? null) : (profile.bridge_kyc_status ?? null);
      const identityMetadata = normalizeMetadata(isBusiness && biz?.bridge_identity_metadata
        ? biz.bridge_identity_metadata
        : profile.bridge_identity_metadata);
      const metadataLast4 = typeof identityMetadata.id_number_last4 === 'string'
        ? identityMetadata.id_number_last4
        : null;
      const idNumberLast4 = metadataLast4 || (profile.id_number ? String(profile.id_number).replace(/\s+/g, '').slice(-4) : null);
      const idNumberPresent = Boolean(profile.id_number || identityMetadata.id_number_present || idNumberLast4);

      return {
        user_id:          profile.id,
        full_name:        profile.full_name || 'Unknown',
        email,
        phone:            profile.phone || '',
        country:          profile.country || '',
        account_type:     profile.account_type || 'individual',
        kyc_status:       profile.kyc_status || 'pending',
        kyc_level:        profile.kyc_level || 0,
        kyc_verified_at:  profile.kyc_verified_at || null,
        account_status:   profile.account_status || 'pending_kyc',
        created_at:       profile.created_at,
        updated_at:       profile.updated_at,

        // Bridge is the active provider surface.
        bridge: {
          customer_id:        profile.bridge_customer_id || null,
          review_status:      bridgeReviewStatus,
          kyb_completed_at:   biz?.bridge_kyb_completed_at || null,
          company_name:       biz?.company_name || null,
          registration_number: biz?.registration_number || null,
          identity: {
            id_type:                  profile.id_type || null,
            id_number_present:        idNumberPresent,
            id_number_masked:         maskIdNumber(profile.id_number) || (idNumberLast4 ? `****${idNumberLast4}` : null),
            date_of_birth:            profile.date_of_birth || null,
            bridge_identity_synced_at: (isBusiness ? biz?.bridge_identity_synced_at : profile.bridge_identity_synced_at) || null,
            source: {
              id_number:     typeof identityMetadata.id_number_source === 'string' ? identityMetadata.id_number_source : null,
              id_type:       typeof identityMetadata.id_type_source === 'string' ? identityMetadata.id_type_source : null,
              date_of_birth: typeof identityMetadata.date_of_birth_source === 'string' ? identityMetadata.date_of_birth_source : null,
            },
          },
        },

        // Historical verification jobs (pre-Bridge). Provider column is
        // surfaced verbatim (no default). If a row has no provider value
        // we leave it null rather than re-branding it.
        legacy_verifications: userVerifications.map((v: any) => ({
          job_id:           v.job_id,
          provider:         v.provider || null,
          status:           v.status,
          document_type:    v.document_type,
          confidence_score: v.confidence_score,
          result_code:      v.result_data?.result_code || null,
          result_text:      v.result_data?.result_text || null,
          verification_id:  v.verification_id || null,
          full_name:        v.result_data?.full_name || null,
          id_type:          v.id_type || v.result_data?.id_type || null,
          country:          v.country_code || v.result_data?.country || null,
          created_at:       v.created_at,
          updated_at:       v.updated_at,
        })),

        verification_result: latestLegacy ? {
          status:          latestLegacy.status,
          verification_id: latestLegacy.verification_id || '',
          provider:        latestLegacy.provider || null,
        } : null,
      };
    });

    const url = new URL(req.url);
    const statusFilter = url.searchParams.get('status');

    const filtered = statusFilter && statusFilter !== 'all'
      ? jobs.filter((j: any) => {
          if (statusFilter === 'verified') return ['verified', 'approved'].includes(j.kyc_status);
          if (statusFilter === 'failed')   return ['failed',   'rejected'].includes(j.kyc_status);
          return j.kyc_status === statusFilter;
        })
      : jobs;

    const stats = {
      total:    jobs.length,
      verified: jobs.filter((j: any) => ['verified', 'approved'].includes(j.kyc_status)).length,
      pending:  jobs.filter((j: any) => j.kyc_status === 'pending').length,
      failed:   jobs.filter((j: any) => j.kyc_status === 'failed' || j.kyc_status === 'rejected').length,
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
