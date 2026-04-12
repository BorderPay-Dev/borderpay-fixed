/**
 * BorderPay Africa — Sync KYC-Approved Users to Maplerad
 *
 * Admin-only endpoint that finds all users with kyc_status='verified'
 * but no maplerad_customer_id, and enrolls them via Maplerad's
 * POST /v1/customers/enroll API.
 *
 * Config: verify_jwt = true (admin-authenticated)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Verify caller is an admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: callerProfile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', caller.id)
      .single();

    if (callerProfile?.role !== 'admin') {
      return new Response(
        JSON.stringify({ success: false, error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get Maplerad API key
    const mapleradKey = Deno.env.get('MAPLERAD_SECRET_KEY_LIVE') || '';
    if (!mapleradKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'MAPLERAD_SECRET_KEY_LIVE not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Query users who are KYC-verified but not yet enrolled in Maplerad
    const { data: users, error: queryError } = await supabase
      .from('user_profiles')
      .select('id, full_name')
      .eq('kyc_status', 'verified')
      .is('maplerad_customer_id', null);

    if (queryError) {
      return new Response(
        JSON.stringify({ success: false, error: `Query failed: ${queryError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const results = {
      total: users?.length || 0,
      enrolled: 0,
      failed: 0,
      skipped: 0,
      errors: [] as Array<{ user_id: string; error: string }>,
    };

    if (!users || users.length === 0) {
      console.log('[sync-users-to-maplerad] No unenrolled verified users found');
      return new Response(
        JSON.stringify({ success: true, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[sync-users-to-maplerad] Found ${users.length} users to process`);

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const userId = user.id;

      try {
        // Rate-limit: 300ms delay between users (skip before first)
        if (i > 0) {
          await delay(300);
        }

        // Fetch KYC submission data
        const { data: kyc, error: kycError } = await supabase
          .from('kyc_submissions')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (kycError || !kyc) {
          console.warn(`[sync-users-to-maplerad] No kyc_submissions for user ${userId}, skipping`);
          results.skipped++;
          continue;
        }

        // Fetch photo URL from kyc_verifications
        const { data: kycVerif } = await supabase
          .from('kyc_verifications')
          .select('photo_url, verification_id')
          .eq('user_id', userId)
          .single();

        // Build Maplerad enrollment body
        const enrollBody: Record<string, any> = {
          first_name: kyc.first_name,
          last_name: kyc.last_name,
          email: kyc.email,
          country: kyc.country,
          identification_number: kyc.id_number,
          dob: kyc.date_of_birth,
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

        if (kyc.id_type && kyc.id_number) {
          enrollBody.identity = {
            type: kyc.id_type,
            number: kyc.id_number,
            image: kycVerif?.photo_url || kyc.id_document_url || '',
            country: kyc.country,
          };
        }

        if (kycVerif?.photo_url || kyc.selfie_url) {
          enrollBody.photo = kycVerif?.photo_url || kyc.selfie_url;
        }

        console.log(`[sync-users-to-maplerad] Enrolling user ${userId} (${i + 1}/${users.length})`);

        // Call Maplerad enroll API
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
          // Success: update user_profiles
          await supabase.from('user_profiles').update({
            maplerad_customer_id: mapleradData.data.id,
            maplerad_status: 'enrolled',
            account_status: 'active',
            enrolled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', userId);

          console.log(`[sync-users-to-maplerad] Enrolled user ${userId}: ${mapleradData.data.id}`);
          results.enrolled++;

        } else {
          // Failure: log to admin_alerts
          const errorMsg = mapleradData.message || mapleradData.error || 'Unknown error';
          console.error(`[sync-users-to-maplerad] Failed for user ${userId}: ${errorMsg}`);

          await supabase.from('admin_alerts').insert({
            alert_type: 'maplerad_sync_failed',
            severity: 'high',
            user_id: userId,
            message: `Maplerad sync enrollment failed: ${errorMsg}`,
            metadata: {
              maplerad_response: mapleradData,
              http_status: mapleradResponse.status,
              sync_run_at: new Date().toISOString(),
            },
            created_at: new Date().toISOString(),
          });

          results.failed++;
          results.errors.push({ user_id: userId, error: errorMsg });
        }

      } catch (err) {
        const errorMsg = (err as Error).message;
        console.error(`[sync-users-to-maplerad] Exception for user ${userId}: ${errorMsg}`);

        await supabase.from('admin_alerts').insert({
          alert_type: 'maplerad_sync_failed',
          severity: 'high',
          user_id: userId,
          message: `Maplerad sync exception: ${errorMsg}`,
          metadata: { exception: errorMsg, sync_run_at: new Date().toISOString() },
          created_at: new Date().toISOString(),
        }).catch(() => { /* best-effort alert */ });

        results.failed++;
        results.errors.push({ user_id: userId, error: errorMsg });
      }
    }

    console.log(`[sync-users-to-maplerad] Complete: ${JSON.stringify(results)}`);

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    console.error('[sync-users-to-maplerad] Fatal error:', (err as Error).message);
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
