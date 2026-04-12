/**
 * BorderPay Africa — Youverify Webhook Callback Handler
 *
 * Receives POST callbacks from Youverify when KYC verification completes.
 * Returns 200 IMMEDIATELY, then processes the result in the background.
 *
 * On approval:
 *   1. Updates kyc_verifications status → approved
 *   2. Updates user_profiles.kyc_status → verified
 *   3. Invokes enroll-maplerad-customer Edge Function
 *   4. Invokes qualify-referral Edge Function (best-effort)
 *   5. Sends KYC approved email via Resend
 *
 * On failure:
 *   1. Updates kyc_verifications status → rejected
 *   2. Updates user_profiles.kyc_status → failed
 *   3. Sends KYC rejected email via Resend
 *
 * Config: verify_jwt = false (server-to-server webhook)
 * Callback URL: https://app.borderpayafrica.com/youverify-callback
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-youverify-signature',
};

// ── HMAC-SHA256 signature verification ──────────────────────────────────────

async function verifyYouverifySignature(
  payload: string,
  receivedSignature: string,
  secretKey: string,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secretKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const computed = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return computed === receivedSignature;
  } catch {
    return false;
  }
}

// ── Email sender ────────────────────────────────────────────────────────────

async function sendKycResultEmail(
  email: string,
  fullName: string,
  passed: boolean,
  resendKey: string,
  fromEmail: string,
) {
  const firstName = (fullName || 'there').split(' ')[0];
  const subject = passed
    ? 'Your identity has been verified — BorderPay'
    : 'KYC verification unsuccessful — BorderPay';

  const html = passed
    ? `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#0B0E11;font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0B0E11;min-height:100vh;">
<tr><td align="center" style="padding:40px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#13171C;border-radius:16px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">
<tr><td style="height:3px;background:linear-gradient(90deg,#C7FF00,#9ECC00);"></td></tr>
<tr><td align="center" style="padding:36px 32px 24px;">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 110" width="44" height="60" style="display:block;"><rect x="10" y="5" width="24" height="95" rx="12" fill="#C7FF00"/><path d="M38 33 A33.5 33.5 0 0 1 38 100 Z" fill="#C7FF00"/></svg>
<p style="margin:12px 0 0;font-size:20px;font-weight:800;color:#FFFFFF;">BorderPay</p>
</td></tr>
<tr><td style="padding:0 32px 32px;">
<div style="text-align:center;margin-bottom:24px;"><div style="display:inline-block;width:64px;height:64px;background:rgba(199,255,0,0.12);border-radius:50%;line-height:64px;font-size:28px;">&#10003;</div></div>
<h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#FFFFFF;text-align:center;">Identity Verified!</h1>
<p style="margin:0 0 24px;font-size:14px;color:#9CA3AF;text-align:center;line-height:1.6;">Hey ${firstName}, great news! Your identity has been successfully verified. You now have full access to all BorderPay features.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:rgba(199,255,0,0.06);border:1px solid rgba(199,255,0,0.15);border-radius:12px;margin-bottom:24px;">
<tr><td style="padding:20px;">
<p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#C7FF00;letter-spacing:0.08em;text-transform:uppercase;">Features now unlocked</p>
<p style="margin:4px 0;font-size:13px;color:#D1D5DB;">&#10003; USD Account</p>
<p style="margin:4px 0;font-size:13px;color:#D1D5DB;">&#10003; Virtual Cards</p>
<p style="margin:4px 0;font-size:13px;color:#D1D5DB;">&#10003; SWIFT Transfers</p>
<p style="margin:4px 0;font-size:13px;color:#D1D5DB;">&#10003; Higher Limits</p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<a href="https://app.borderpayafrica.com" target="_blank" style="display:inline-block;padding:14px 40px;background-color:#C7FF00;color:#0B0E11;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Open BorderPay</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 32px;"><div style="height:1px;background-color:rgba(255,255,255,0.06);"></div></td></tr>
<tr><td style="padding:24px 32px;"><p style="margin:0;font-size:11px;color:#4B5563;text-align:center;">&copy; ${new Date().getFullYear()} BorderPay Africa. All rights reserved.</p></td></tr>
</table></td></tr></table></body></html>`
    : `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#0B0E11;font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0B0E11;min-height:100vh;">
<tr><td align="center" style="padding:40px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#13171C;border-radius:16px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">
<tr><td style="height:3px;background:linear-gradient(90deg,#EF4444,#DC2626);"></td></tr>
<tr><td align="center" style="padding:36px 32px 24px;">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 110" width="44" height="60" style="display:block;"><rect x="10" y="5" width="24" height="95" rx="12" fill="#C7FF00"/><path d="M38 33 A33.5 33.5 0 0 1 38 100 Z" fill="#C7FF00"/></svg>
<p style="margin:12px 0 0;font-size:20px;font-weight:800;color:#FFFFFF;">BorderPay</p>
</td></tr>
<tr><td style="padding:0 32px 32px;">
<div style="text-align:center;margin-bottom:24px;"><div style="display:inline-block;width:64px;height:64px;background:rgba(239,68,68,0.12);border-radius:50%;line-height:64px;font-size:28px;color:#EF4444;">&#10007;</div></div>
<h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#FFFFFF;text-align:center;">Verification Unsuccessful</h1>
<p style="margin:0 0 24px;font-size:14px;color:#9CA3AF;text-align:center;line-height:1.6;">Hey ${firstName}, unfortunately we were unable to verify your identity. This can happen if the document was unclear, expired, or the selfie didn't match.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:12px;margin-bottom:24px;">
<tr><td style="padding:20px;">
<p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#EF4444;letter-spacing:0.08em;text-transform:uppercase;">Tips for a successful retry</p>
<p style="margin:4px 0;font-size:13px;color:#D1D5DB;">&bull; Use a valid, unexpired government ID</p>
<p style="margin:4px 0;font-size:13px;color:#D1D5DB;">&bull; Ensure the document is fully visible and well-lit</p>
<p style="margin:4px 0;font-size:13px;color:#D1D5DB;">&bull; Take your selfie in good lighting</p>
<p style="margin:4px 0;font-size:13px;color:#D1D5DB;">&bull; Make sure your face matches the ID photo</p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<a href="https://app.borderpayafrica.com" target="_blank" style="display:inline-block;padding:14px 40px;background-color:#C7FF00;color:#0B0E11;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Try Again</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:12px;color:#6B7280;text-align:center;line-height:1.5;">Need help? Contact us at <a href="mailto:support@borderpayafrica.com" style="color:#C7FF00;text-decoration:none;">support@borderpayafrica.com</a></p>
</td></tr>
<tr><td style="padding:0 32px;"><div style="height:1px;background-color:rgba(255,255,255,0.06);"></div></td></tr>
<tr><td style="padding:24px 32px;"><p style="margin:0;font-size:11px;color:#4B5563;text-align:center;">&copy; ${new Date().getFullYear()} BorderPay Africa. All rights reserved.</p></td></tr>
</table></td></tr></table></body></html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resendKey}`,
    },
    body: JSON.stringify({ from: fromEmail, to: [email], subject, html }),
  });
}

// ── Async processor — runs in background after 200 is returned ──────────────

async function processYouverifyCallback(body: any, rawBody: string, signature: string | null) {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    console.log('[youverify-callback] Received callback:', JSON.stringify({
      id: body.id,
      status: body.status,
      has_metadata: !!body.metadata,
      has_data: !!body.data,
    }));

    // Verify HMAC signature using Youverify's "HTTP Webhook Signin Key"
    const secretKey = Deno.env.get('YOUVERIFY_WEBHOOK_SIGNIN_KEY') || '';
    if (secretKey && signature) {
      const valid = await verifyYouverifySignature(rawBody, signature, secretKey);
      if (!valid) {
        console.warn('[youverify-callback] Invalid signature — dropping callback');
        return;
      }
    }

    // Extract user ID from metadata
    const metadata = body.metadata || {};
    const userId = metadata.userId || metadata.user_id || null;

    if (!userId) {
      console.warn('[youverify-callback] No userId in metadata — dropping');
      return;
    }

    // Map Youverify status to our internal status
    const youverifyStatus = (body.status || '').toLowerCase();
    let kycStatus: 'pending' | 'approved' | 'rejected' = 'pending';
    if (youverifyStatus === 'verified' || youverifyStatus === 'success' || youverifyStatus === 'completed') {
      kycStatus = 'approved';
    } else if (youverifyStatus === 'failed' || youverifyStatus === 'rejected' || youverifyStatus === 'declined') {
      kycStatus = 'rejected';
    }

    // Extract photo URL if available
    const photoUrl = body.data?.photo_url || body.photo_url || null;
    const verificationId = body.id || body.verification_id || null;

    // Upsert verification record
    await supabase.from('kyc_verifications').upsert({
      user_id: userId,
      status: kycStatus,
      provider: 'youverify',
      verification_id: verificationId,
      photo_url: photoUrl,
      country_code: metadata.country || null,
      id_type: metadata.idType || null,
      result_data: {
        youverify_status: body.status,
        youverify_id: verificationId,
        callback_received_at: new Date().toISOString(),
        raw_data: body.data || null,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    console.log(`[youverify-callback] Updated kyc_verifications: user=${userId}, status=${kycStatus}`);

    if (kycStatus === 'approved') {
      // Update user_profiles
      await supabase.from('user_profiles').update({
        kyc_status: 'verified',
        kyc_level: 2,
        kyc_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', userId);

      console.log(`[youverify-callback] User ${userId} approved — triggering Maplerad enrollment`);

      // Trigger Maplerad full enrollment
      try {
        const { error: enrollError } = await supabase.functions.invoke('enroll-maplerad-customer', {
          body: { userId },
        });
        if (enrollError) {
          console.error('[youverify-callback] enroll-maplerad-customer error:', enrollError.message);
        } else {
          console.log(`[youverify-callback] enroll-maplerad-customer triggered for user=${userId}`);
        }
      } catch (e) {
        console.error('[youverify-callback] enroll-maplerad-customer invoke failed:', (e as Error).message);
      }

      // Trigger referral qualification (best-effort)
      try {
        await supabase.functions.invoke('qualify-referral', { body: { user_id: userId } });
        console.log(`[youverify-callback] qualify-referral triggered for user=${userId}`);
      } catch {
        // Non-fatal
      }

      // Send approval email
      const resendKey = Deno.env.get('RESEND_API_KEY') || '';
      const fromEmail = Deno.env.get('BORDERPAY_FROM_EMAIL') || 'BorderPay <noreply@borderpayafrica.com>';
      if (resendKey) {
        const { data: { user: authUser } } = await supabase.auth.admin.getUserById(userId);
        const { data: profile } = await supabase.from('user_profiles').select('full_name').eq('id', userId).single();
        if (authUser?.email) {
          try {
            await sendKycResultEmail(authUser.email, profile?.full_name || authUser.email, true, resendKey, fromEmail);
            console.log(`[youverify-callback] Approval email sent to ${authUser.email}`);
          } catch (e) {
            console.error('[youverify-callback] Email failed:', (e as Error).message);
          }
        }
      }

    } else if (kycStatus === 'rejected') {
      await supabase.from('user_profiles').update({
        kyc_status: 'failed',
        kyc_level: 0,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);

      // Send rejection email
      const resendKey = Deno.env.get('RESEND_API_KEY') || '';
      const fromEmail = Deno.env.get('BORDERPAY_FROM_EMAIL') || 'BorderPay <noreply@borderpayafrica.com>';
      if (resendKey) {
        const { data: { user: authUser } } = await supabase.auth.admin.getUserById(userId);
        const { data: profile } = await supabase.from('user_profiles').select('full_name').eq('id', userId).single();
        if (authUser?.email) {
          try {
            await sendKycResultEmail(authUser.email, profile?.full_name || authUser.email, false, resendKey, fromEmail);
          } catch { /* silent */ }
        }
      }
    }

    console.log(`[youverify-callback] Callback fully processed for user=${userId}`);

  } catch (err) {
    console.error('[youverify-callback] Processing error:', (err as Error).message);
  }
}

// ── HTTP handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Read body and signature BEFORE returning 200
  let body: any = {};
  let rawBody = '';
  const signature = req.headers.get('x-youverify-signature');

  try {
    rawBody = await req.text();
    body = JSON.parse(rawBody);
  } catch {
    return new Response(
      JSON.stringify({ received: true, warning: 'invalid_json' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Kick off background processing
  const processingPromise = processYouverifyCallback(body, rawBody, signature);
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(processingPromise);
  } else {
    processingPromise.catch((err) =>
      console.error('[youverify-callback] Background error:', (err as Error).message),
    );
  }

  // Return 200 immediately so Youverify doesn't retry
  return new Response(
    JSON.stringify({ received: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
