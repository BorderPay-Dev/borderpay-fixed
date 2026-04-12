/**
 * BorderPay Africa — Youverify KYC Status Check
 *
 * Authenticated endpoint for the frontend to poll KYC verification status.
 * Also handles POST to register a pending KYC submission.
 *
 * GET:  Returns current KYC status for authenticated user
 * POST: Registers/updates a KYC submission with user details
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

    // ── POST: save KYC submission data ─────────────────────────────────────────
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));

      // Upsert KYC submission (all fields needed for Maplerad enroll later)
      const submissionData: Record<string, any> = {
        user_id: user.id,
        updated_at: new Date().toISOString(),
      };

      // Map frontend field names to DB columns
      const fieldMap: Record<string, string> = {
        firstName: 'first_name',
        lastName: 'last_name',
        email: 'email',
        dateOfBirth: 'date_of_birth',
        phoneCode: 'phone_code',
        phoneNumber: 'phone_number',
        country: 'country',
        street: 'street',
        city: 'city',
        state: 'state',
        postalCode: 'postal_code',
        idType: 'id_type',
        idNumber: 'id_number',
        usResidencyStatus: 'us_residency_status',
        employmentStatus: 'employment_status',
      };

      for (const [frontKey, dbKey] of Object.entries(fieldMap)) {
        if (body[frontKey] !== undefined) {
          submissionData[dbKey] = body[frontKey];
        }
      }

      const { error: upsertError } = await supabase
        .from('kyc_submissions')
        .upsert(submissionData, { onConflict: 'user_id' });

      if (upsertError) {
        console.error('[youverify-kyc-status] Upsert error:', upsertError.message);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to save KYC data' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Also upsert a pending verification record
      await supabase.from('kyc_verifications').upsert({
        user_id: user.id,
        status: 'pending',
        provider: 'youverify',
        country_code: body.country || null,
        id_type: body.idType || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── GET: check current KYC status ──────────────────────────────────────────

    // Check user_profiles first
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('kyc_status, maplerad_status, maplerad_customer_id, account_status')
      .eq('id', user.id)
      .single();

    if (profile?.kyc_status === 'verified') {
      return new Response(
        JSON.stringify({
          success: true,
          status: 'verified',
          maplerad_status: profile.maplerad_status || 'not_enrolled',
          enrolled: !!profile.maplerad_customer_id,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Check latest verification record
    const { data: verification } = await supabase
      .from('kyc_verifications')
      .select('status, provider, verification_id, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!verification) {
      return new Response(
        JSON.stringify({ success: true, status: profile?.kyc_status || 'not_started' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (verification.status === 'approved' || verification.status === 'verified') {
      return new Response(
        JSON.stringify({ success: true, status: 'verified' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (verification.status === 'failed' || verification.status === 'rejected') {
      return new Response(
        JSON.stringify({ success: true, status: 'failed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, status: 'pending' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
