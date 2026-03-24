/**
 * BorderPay Africa — Send Confirmation Email
 * Sends a branded email verification link via Resend.
 *
 * Expects JSON body:
 *   { email, full_name, confirmation_url }
 *
 * Environment:
 *   RESEND_API_KEY — Resend API key
 *   BORDERPAY_FROM_EMAIL — e.g. "BorderPay <noreply@borderpayafrica.com>"
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, full_name, confirmation_url } = await req.json();

    if (!email || !confirmation_url) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing email or confirmation_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const FROM_EMAIL = Deno.env.get('BORDERPAY_FROM_EMAIL') || 'BorderPay <noreply@borderpayafrica.com>';

    if (!RESEND_API_KEY) {
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
<body style="margin:0;padding:0;background-color:#0B0E11;font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0B0E11;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#13171C;border-radius:16px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">

          <!-- Top accent bar -->
          <tr>
            <td style="height:3px;background:linear-gradient(90deg,#C7FF00,#9ECC00);"></td>
          </tr>

          <!-- Logo -->
          <tr>
            <td align="center" style="padding:36px 32px 24px;">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 110" width="44" height="60" style="display:block;">
                <rect x="10" y="5" width="24" height="95" rx="12" fill="#C7FF00"/>
                <path d="M38 33 A33.5 33.5 0 0 1 38 100 Z" fill="#C7FF00"/>
              </svg>
              <p style="margin:12px 0 0;font-size:20px;font-weight:800;color:#FFFFFF;letter-spacing:-0.3px;">BorderPay</p>
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
                    <a href="${confirmation_url}"
                       target="_blank"
                       style="display:inline-block;padding:14px 40px;background-color:#C7FF00;color:#0B0E11;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;letter-spacing:0.3px;">
                      Verify My Email
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:12px;color:#6B7280;text-align:center;line-height:1.5;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:8px 0 0;font-size:11px;color:#C7FF00;text-align:center;word-break:break-all;line-height:1.4;">
                ${confirmation_url}
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

    const res = await fetch('https://api.resend.com/emails', {
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

    const resData = await res.json();

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
