import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';

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

  const html = passed ? `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#0B0E11;font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0B0E11;min-height:100vh;">
    <tr><td align="center" style="padding:40px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#13171C;border-radius:16px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">
        <tr><td style="height:3px;background:linear-gradient(90deg,#C7FF00,#9ECC00);"></td></tr>
        <tr>
          <td align="center" style="padding:36px 32px 24px;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 110" width="44" height="60" style="display:block;">
              <rect x="10" y="5" width="24" height="95" rx="12" fill="#C7FF00"/>
              <path d="M38 33 A33.5 33.5 0 0 1 38 100 Z" fill="#C7FF00"/>
            </svg>
            <p style="margin:12px 0 0;font-size:20px;font-weight:800;color:#FFFFFF;letter-spacing:-0.3px;">BorderPay</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="display:inline-block;width:64px;height:64px;background:rgba(199,255,0,0.12);border-radius:50%;line-height:64px;font-size:28px;">✓</div>
            </div>
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#FFFFFF;text-align:center;">Identity Verified!</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#9CA3AF;text-align:center;line-height:1.6;">
              Hey ${firstName}, great news! Your identity has been successfully verified. You now have full access to all BorderPay features.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:rgba(199,255,0,0.06);border:1px solid rgba(199,255,0,0.15);border-radius:12px;margin-bottom:24px;">
              <tr><td style="padding:20px;">
                <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#C7FF00;letter-spacing:0.08em;text-transform:uppercase;">Features now unlocked</p>
                <p style="margin:4px 0;font-size:13px;color:#D1D5DB;">✓ &nbsp;USD Account</p>
                <p style="margin:4px 0;font-size:13px;color:#D1D5DB;">✓ &nbsp;Virtual Cards</p>
                <p style="margin:4px 0;font-size:13px;color:#D1D5DB;">✓ &nbsp;SWIFT Transfers</p>
                <p style="margin:4px 0;font-size:13px;color:#D1D5DB;">✓ &nbsp;Higher Limits</p>
              </td></tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center">
                <a href="https://app.borderpayafrica.com" target="_blank"
                   style="display:inline-block;padding:14px 40px;background-color:#C7FF00;color:#0B0E11;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">
                  Open BorderPay
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr><td style="padding:0 32px;"><div style="height:1px;background-color:rgba(255,255,255,0.06);"></div></td></tr>
        <tr><td style="padding:24px 32px;">
          <p style="margin:0;font-size:11px;color:#4B5563;text-align:center;">&copy; ${new Date().getFullYear()} BorderPay Africa. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>` : `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#0B0E11;font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0B0E11;min-height:100vh;">
    <tr><td align="center" style="padding:40px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#13171C;border-radius:16px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">
        <tr><td style="height:3px;background:linear-gradient(90deg,#EF4444,#DC2626);"></td></tr>
        <tr>
          <td align="center" style="padding:36px 32px 24px;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 110" width="44" height="60" style="display:block;">
              <rect x="10" y="5" width="24" height="95" rx="12" fill="#C7FF00"/>
              <path d="M38 33 A33.5 33.5 0 0 1 38 100 Z" fill="#C7FF00"/>
            </svg>
            <p style="margin:12px 0 0;font-size:20px;font-weight:800;color:#FFFFFF;letter-spacing:-0.3px;">BorderPay</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="display:inline-block;width:64px;height:64px;background:rgba(239,68,68,0.12);border-radius:50%;line-height:64px;font-size:28px;color:#EF4444;">✗</div>
            </div>
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#FFFFFF;text-align:center;">Verification Unsuccessful</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#9CA3AF;text-align:center;line-height:1.6;">
              Hey ${firstName}, unfortunately we were unable to verify your identity. This can happen if the document was unclear, expired, or the selfie didn't match.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:12px;margin-bottom:24px;">
              <tr><td style="padding:20px;">
                <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#EF4444;letter-spacing:0.08em;text-transform:uppercase;">Tips for a successful retry</p>
                <p style="margin:4px 0;font-size:13px;color:#D1D5DB;">• Use a valid, unexpired government ID</p>
                <p style="margin:4px 0;font-size:13px;color:#D1D5DB;">• Ensure the document is fully visible and well-lit</p>
                <p style="margin:4px 0;font-size:13px;color:#D1D5DB;">• Take your selfie in good lighting</p>
                <p style="margin:4px 0;font-size:13px;color:#D1D5DB;">• Make sure your face matches the ID photo</p>
              </td></tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center">
                <a href="https://app.borderpayafrica.com" target="_blank"
                   style="display:inline-block;padding:14px 40px;background-color:#C7FF00;color:#0B0E11;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">
                  Try Again
                </a>
              </td></tr>
            </table>
            <p style="margin:20px 0 0;font-size:12px;color:#6B7280;text-align:center;line-height:1.5;">
              Need help? Contact us at <a href="mailto:support@borderpayafrica.com" style="color:#C7FF00;text-decoration:none;">support@borderpayafrica.com</a>
            </p>
          </td>
        </tr>
        <tr><td style="padding:0 32px;"><div style="height:1px;background-color:rgba(255,255,255,0.06);"></div></td></tr>
        <tr><td style="padding:24px 32px;">
          <p style="margin:0;font-size:11px;color:#4B5563;text-align:center;">&copy; ${new Date().getFullYear()} BorderPay Africa. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resendKey}`,
    },
    body: JSON.stringify({ from: fromEmail, to: [email], subject, html }),
  });
}

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
    const passed = smileData.job_success === true;
    const newStatus = passed ? 'verified' : 'failed';

    // Get user email + name for the result email
    const { data: { user: authUser } } = await supabase.auth.admin.getUserById(user.id);
    const { data: profileForEmail } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

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

    // Send KYC result email (non-blocking)
    const resendKey = Deno.env.get('RESEND_API_KEY') || '';
    const fromEmail = Deno.env.get('BORDERPAY_FROM_EMAIL') || 'BorderPay <noreply@borderpayafrica.com>';
    if (resendKey && authUser?.email) {
      sendKycResultEmail(
        authUser.email,
        profileForEmail?.full_name || authUser.email,
        passed,
        resendKey,
        fromEmail,
      ).catch(() => { /* silent — don't fail status update if email fails */ });
    }

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
