/**
 * BorderPay Africa — KYC Submit
 *
 * Receives the full KYC submission from the frontend after the user has uploaded
 * their documents directly to the `kyc-documents` private storage bucket.
 *
 * Flow:
 *   1. Verify caller's JWT.
 *   2. Validate payload + ownership of all storage paths.
 *   3. Generate 24h signed URLs for selfie and ID front (sent to Maplerad).
 *   4. POST /v1/customers/enroll on Maplerad with the user's full data.
 *   5. Persist result + status into kyc_submissions and user_profiles.
 *
 * Rate limit: 3 attempts per user per 24h.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function maskId(s: string): string {
  if (!s) return '';
  if (s.length <= 4) return '****';
  return '*'.repeat(s.length - 4) + s.slice(-4);
}

function calcAge(dobDDMMYYYY: string): number {
  const [d, m, y] = dobDDMMYYYY.split('-').map(Number);
  if (!d || !m || !y) return 0;
  const dob = new Date(y, m - 1, d);
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ success: false, error: 'Missing Authorization header' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ success: false, error: 'Unauthorized' }, 401);

    const body = await req.json();
    const {
      firstName, lastName, email, dateOfBirth,
      phoneCode, phoneNumber, country,
      street, street2, city, state, postalCode,
      idType, idNumber, mapleradIdentityType,
      idFrontPath, idBackPath, selfiePath, poaPath, poaDocumentType,
    } = body || {};

    const required = { firstName, lastName, email, dateOfBirth, phoneCode, phoneNumber,
      country, street, city, state, idType, idNumber, mapleradIdentityType,
      idFrontPath, selfiePath };
    for (const [k, v] of Object.entries(required)) {
      if (!v || typeof v !== 'string') return json({ success: false, error: `Missing field: ${k}` }, 400);
    }

    if (!/^\d{2}-\d{2}-\d{4}$/.test(dateOfBirth)) {
      return json({ success: false, error: 'Date of birth must be DD-MM-YYYY' }, 400);
    }
    if (calcAge(dateOfBirth) < 18) {
      return json({ success: false, error: 'You must be at least 18 years old' }, 400);
    }

    const userPrefix = `${user.id}/`;
    const allPaths = [idFrontPath, idBackPath, selfiePath, poaPath].filter(Boolean) as string[];
    for (const p of allPaths) {
      if (!p.startsWith(userPrefix)) {
        return json({ success: false, error: 'Invalid storage path' }, 400);
      }
    }

    const { data: existing } = await supabase
      .from('kyc_submissions')
      .select('attempt_count, last_attempt_at, submission_status, maplerad_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing?.submission_status === 'approved') {
      return json({ success: true, status: 'approved', already_verified: true });
    }
    if (existing?.last_attempt_at) {
      const since = Date.now() - new Date(existing.last_attempt_at).getTime();
      if (since < 24 * 3600 * 1000 && (existing.attempt_count || 0) >= 3) {
        return json({ success: false, error: 'Too many attempts. Please try again in 24 hours.' }, 429);
      }
    }

    const signedUrl = async (path?: string | null): Promise<string | null> => {
      if (!path) return null;
      const { data, error } = await supabase.storage.from('kyc-documents').createSignedUrl(path, 86400);
      if (error || !data?.signedUrl) {
        console.error('[kyc-submit] Failed to sign', path, error?.message);
        return null;
      }
      return data.signedUrl;
    };

    const selfieUrl = await signedUrl(selfiePath);
    const idFrontUrl = await signedUrl(idFrontPath);
    if (!selfieUrl || !idFrontUrl) return json({ success: false, error: 'Could not access uploaded documents' }, 500);

    const mapleradKey = Deno.env.get('MAPLERAD_SECRET_KEY_LIVE') || Deno.env.get('MAPLERAD_SECRET_KEY');
    if (!mapleradKey) return json({ success: false, error: 'Maplerad key not configured' }, 500);

    const enrollBody = {
      first_name: firstName,
      last_name: lastName,
      email,
      country,
      identification_number: idNumber,
      dob: dateOfBirth,
      phone: { phone_country_code: phoneCode, phone_number: phoneNumber },
      address: {
        street,
        street2: street2 || '',
        city,
        state,
        country,
        postal_code: postalCode || '000000',
      },
      identity: {
        type: mapleradIdentityType,
        number: idNumber,
        image: idFrontUrl,
        country,
      },
      photo: selfieUrl,
    };

    const baseRow = {
      user_id: user.id,
      first_name: firstName,
      last_name: lastName,
      email,
      phone_code: phoneCode,
      phone_number: phoneNumber,
      date_of_birth: dateOfBirth,
      country,
      country_code: country,
      id_type: idType,
      id_number: maskId(idNumber),
      street, city, state, postal_code: postalCode || null,
      id_front_path: idFrontPath,
      id_back_path: idBackPath || null,
      selfie_path: selfiePath,
      poa_path: poaPath || null,
      poa_document_type: poaDocumentType || null,
      submission_status: 'under_review',
      submitted_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
      attempt_count: (existing?.attempt_count || 0) + 1,
      updated_at: new Date().toISOString(),
    };

    await supabase.from('kyc_submissions').upsert(baseRow, { onConflict: 'user_id' });

    console.log('[kyc-submit] Enrolling user', user.id, 'country', country, 'type', mapleradIdentityType);
    const mapleradRes = await fetch('https://api.maplerad.com/v1/customers/enroll', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mapleradKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(enrollBody),
    });

    const mapleradText = await mapleradRes.text();
    let mapleradData: any = {};
    try { mapleradData = JSON.parse(mapleradText); } catch { /* keep raw */ }

    console.log('[kyc-submit] Maplerad', mapleradRes.status, mapleradText.slice(0, 400));

    if (mapleradRes.ok && (mapleradData?.status === true || mapleradData?.data?.id)) {
      const customerId = mapleradData.data?.id;
      const customerStatus: string = (mapleradData.data?.status || 'COMPLETED').toString().toUpperCase();
      const isApproved = customerStatus === 'COMPLETED' || customerStatus === 'APPROVED';

      await supabase.from('kyc_submissions').update({
        submission_status: isApproved ? 'approved' : 'under_review',
        maplerad_customer_id: customerId,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id);

      if (isApproved) {
        await supabase.from('user_profiles').update({
          maplerad_customer_id: customerId,
          maplerad_status: 'enrolled',
          kyc_status: 'verified',
          account_status: 'active',
          enrolled_at: new Date().toISOString(),
          kyc_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', user.id);
      }

      return json({
        success: true,
        status: isApproved ? 'approved' : 'under_review',
        maplerad_customer_id: customerId,
      });
    }

    const reason: string = mapleradData?.message || mapleradData?.error || `HTTP ${mapleradRes.status}`;

    await supabase.from('kyc_submissions').update({
      submission_status: 'rejected',
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    }).eq('user_id', user.id);

    await supabase.from('user_profiles').update({
      maplerad_status: 'enroll_failed',
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);

    try {
      await supabase.from('admin_alerts').insert({
        alert_type: 'maplerad_enroll_failed',
        severity: 'high',
        user_id: user.id,
        message: `KYC enrollment failed: ${reason}`,
        metadata: mapleradData,
        created_at: new Date().toISOString(),
      });
    } catch { /* admin_alerts may not exist or have different shape */ }

    return json({ success: false, status: 'rejected', error: reason }, 200);

  } catch (err) {
    console.error('[kyc-submit] Error:', (err as Error).message);
    return json({ success: false, error: (err as Error).message }, 500);
  }
});
