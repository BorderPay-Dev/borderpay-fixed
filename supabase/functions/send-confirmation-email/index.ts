/**
 * BorderPay Africa — Send Confirmation Email
 * Sends a branded email verification link via Brevo (preferred) or Resend fallback.
 *
 * Expects JSON body:
 *   { email, full_name, confirmation_url }
 *
 * Environment:
 *   BREVO_API_KEY — Brevo API key (preferred)
 *   RESEND_API_KEY — Resend API key (fallback)
 *   BORDERPAY_FROM_EMAIL — e.g. "BorderPay <noreply@borderpayafrica.com>"
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const INTERNAL_TOKEN = Deno.env.get('SEND_EMAIL_INTERNAL_TOKEN') || '';
const APP_URL = Deno.env.get('BORDERPAY_APP_URL') || 'https://app.borderpayafrica.com';
const EMAIL_LOGO_URL = 'https://orwrcpwsffjlvzuraxjc.supabase.co/storage/v1/object/public/email-logo.png/assets/borderpay-white-logo-email.png';

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length === 0 || ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'POST only' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!INTERNAL_TOKEN || !timingSafeEqualStr(token, INTERNAL_TOKEN)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized — internal token required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { email, full_name, confirmation_url } = await req.json();

    if (!email || !confirmation_url) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing email or confirmation_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    let parsedConfirmation: URL;
    let appOrigin: URL;
    try {
      parsedConfirmation = new URL(String(confirmation_url));
      appOrigin = new URL(APP_URL);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid confirmation URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (parsedConfirmation.origin !== appOrigin.origin) {
      return new Response(
        JSON.stringify({ success: false, error: 'confirmation_url origin not allowed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const safeConfirmationUrl = parsedConfirmation.toString();

    const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') || Deno.env.get('BREVO_API_KEYS');
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const FROM_EMAIL = Deno.env.get('BORDERPAY_FROM_EMAIL') || 'BorderPay <noreply@borderpayafrica.com>';

    if (!BREVO_API_KEY && !RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'Email service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const firstName = (full_name || 'there').split(' ')[0];

    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirm your email — BorderPay</title>
</head>
<body style="margin:0;padding:0;background-color:#000000;font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#000000;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#000000;border:1px solid #1A1A1A;overflow:hidden;">

          <!-- Top accent bar -->
          <tr>
            <td style="height:3px;background:linear-gradient(90deg,#C7FF00,#9ECC00);"></td>
          </tr>

          <!-- Logo -->
          <tr>
            <td align="left" style="padding:26px 32px 20px;">
              <img src="${EMAIL_LOGO_URL}" alt="BorderPay Africa" width="168" style="display:block;width:168px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:0 32px 32px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#FFFFFF;text-align:center;">
                Confirm your email
              </h1>
              <p style="margin:0 0 28px;font-size:14px;color:#9CA3AF;text-align:center;line-height:1.6;">
                Hey ${firstName}, thanks for signing up! Tap the button below to verify your email and activate your account.
              </p>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${safeConfirmationUrl}"
                       target="_blank"
                       style="display:inline-block;padding:14px 40px;background-color:#C7FF00;color:#000000;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;letter-spacing:0.3px;">
                      Verify My Email
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:12px;color:#6B7280;text-align:center;line-height:1.5;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:8px 0 0;font-size:11px;color:#C7FF00;text-align:center;word-break:break-all;line-height:1.4;">
                ${safeConfirmationUrl}
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <div style="height:1px;background-color:rgba(255,255,255,0.06);"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px 32px;">
              <p style="margin:0 0 4px;font-size:11px;color:#6B7280;text-align:center;">
                This link expires in 24 hours. If you didn't create this account, you can safely ignore this email.
              </p>
              <p style="margin:12px 0 0;font-size:11px;color:#4B5563;text-align:center;">
                &copy; ${new Date().getFullYear()} BorderPay Africa. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    let res: Response;
    let resData: any = {};
    if (BREVO_API_KEY) {
      res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': BREVO_API_KEY,
        },
        body: JSON.stringify({
          sender: parseSender(FROM_EMAIL),
          to: [{ email }],
          subject: 'Confirm your email — BorderPay',
          htmlContent: htmlBody,
        }),
      });
      resData = await res.json().catch(() => ({}));
      if (res.ok) {
        return new Response(
          JSON.stringify({ success: true, message_id: resData.messageId }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // Fail-safe: if Brevo key is invalid/forbidden, fall back to Resend if configured.
      if (RESEND_API_KEY && (res.status === 401 || res.status === 403)) {
        console.error('Brevo auth error; falling back to Resend:', resData);
      } else {
        console.error('Brevo error:', resData);
        return new Response(
          JSON.stringify({ success: false, error: resData.message || 'Email send failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: 'Confirm your email — BorderPay',
        html: htmlBody,
      }),
    });

    resData = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('Resend error:', resData);
      return new Response(
        JSON.stringify({ success: false, error: resData.message || 'Email send failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message_id: resData.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('send-confirmation-email error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function parseSender(raw: string): { email: string; name?: string } {
  const match = raw.match(/^\s*([^<]+?)\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1]?.trim();
    const email = match[2]?.trim();
    return name ? { name, email } : { email };
  }
  return { email: raw.trim() };
}
