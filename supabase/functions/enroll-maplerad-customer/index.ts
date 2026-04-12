/**
 * BorderPay Africa — Maplerad Full Customer Enrollment
 *
 * Called by youverify-callback after KYC is approved.
 * Makes a single POST /v1/customers/enroll call to Maplerad which
 * creates a fully enrolled customer with access to ALL Maplerad
 * resources including Issuing (cards), Collections, Transfers.
 *
 * No tier upgrades needed — one call does everything.
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
    const { userId } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'userId required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. Get KYC submission data (collected during onboarding)
    const { data: kyc, error: kycError } = await supabase
      .from('kyc_submissions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (kycError || !kyc) {
      console.error('[enroll-maplerad] No KYC submission found for user', userId, kycError?.message);
      return new Response(
        JSON.stringify({ success: false, error: 'No KYC submission found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 2. Get liveness photo URL from Youverify (stored in kyc_verifications)
    const { data: kycVerif } = await supabase
      .from('kyc_verifications')
      .select('photo_url, verification_id')
      .eq('user_id', userId)
      .single();

    // 3. Check if already enrolled (idempotency)
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('maplerad_customer_id')
      .eq('id', userId)
      .single();

    if (existingProfile?.maplerad_customer_id) {
      console.log('[enroll-maplerad] User already enrolled:', existingProfile.maplerad_customer_id);
      return new Response(
        JSON.stringify({
          success: true,
          data: { id: existingProfile.maplerad_customer_id },
          already_enrolled: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 4. Call Maplerad enroll endpoint — single call, full access
    const mapleradKey = Deno.env.get('MAPLERAD_SECRET_KEY_LIVE') || Deno.env.get('MAPLERAD_SECRET_KEY') || '';
    if (!mapleradKey) {
      console.error('[enroll-maplerad] MAPLERAD_SECRET_KEY_LIVE not set');
      return new Response(
        JSON.stringify({ success: false, error: 'Maplerad key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const enrollBody: Record<string, any> = {
      first_name: kyc.first_name,
      last_name: kyc.last_name,
      email: kyc.email,
      country: kyc.country,
      identification_number: kyc.id_number,
      dob: kyc.date_of_birth, // DD-MM-YYYY format
      phone: {
        phone_country_code: kyc.phone_code,
        phone_number: kyc.phone_number,
      },
      address: {
        street: kyc.street,
        city: kyc.city,
        state: kyc.state,
        country: kyc.country,
        postal_code: kyc.postal_code || '000000',
      },
    };

    // Add identity block if we have the data
    if (kyc.id_type && kyc.id_number) {
      enrollBody.identity = {
        type: kyc.id_type,
        number: kyc.id_number,
        image: kycVerif?.photo_url || kyc.id_document_url || '',
        country: kyc.country,
      };
    }

    // Add photo if available
    if (kycVerif?.photo_url || kyc.selfie_url) {
      enrollBody.photo = kycVerif?.photo_url || kyc.selfie_url;
    }

    console.log('[enroll-maplerad] Calling POST /v1/customers/enroll for user', userId);

    const mapleradResponse = await fetch(
      'https://api.maplerad.com/v1/customers/enroll',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mapleradKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(enrollBody),
      },
    );

    const mapleradData = await mapleradResponse.json();

    if (mapleradResponse.ok && mapleradData.data?.id) {
      // 5. Save Maplerad customer ID to user_profiles
      await supabase.from('user_profiles').update({
        maplerad_customer_id: mapleradData.data.id,
        maplerad_status: 'enrolled',
        kyc_status: 'verified',
        account_status: 'active',
        enrolled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', userId);

      console.log('[enroll-maplerad] Enrollment successful:', mapleradData.data.id);

      // 6. Create USD wallet for the user (best-effort)
      try {
        await supabase.functions.invoke('create-usd-wallet', {
          body: { userId, mapleradCustomerId: mapleradData.data.id },
        });
        console.log('[enroll-maplerad] USD wallet creation triggered for user', userId);
      } catch (e) {
        console.warn('[enroll-maplerad] create-usd-wallet invoke skipped:', (e as Error).message);
      }

      return new Response(
        JSON.stringify({ success: true, data: mapleradData.data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );

    } else {
      // Enrollment failed — log and alert admin
      console.error('[enroll-maplerad] Maplerad enroll failed:', JSON.stringify(mapleradData));

      await supabase.from('user_profiles').update({
        maplerad_status: 'enroll_failed',
        updated_at: new Date().toISOString(),
      }).eq('id', userId);

      // Create admin alert
      await supabase.from('admin_alerts').insert({
        alert_type: 'maplerad_enroll_failed',
        severity: 'high',
        user_id: userId,
        message: `Maplerad enrollment failed: ${mapleradData.message || mapleradData.error || 'Unknown error'}`,
        metadata: mapleradData,
        created_at: new Date().toISOString(),
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: 'Maplerad enrollment failed',
          details: mapleradData.message || mapleradData.error || 'Unknown error',
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

  } catch (err) {
    console.error('[enroll-maplerad] Error:', (err as Error).message);
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
