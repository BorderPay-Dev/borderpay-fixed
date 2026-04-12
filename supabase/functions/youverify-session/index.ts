/**
 * BorderPay Africa — Youverify Liveness Session Generator
 *
 * Generates sessionId and sessionToken required by the youverify-liveness-web
 * SDK on the frontend. These tokens must be created server-side using the
 * Youverify API key.
 *
 * POST body: { publicMerchantID: string, metadata?: object }
 * Returns:   { success: true, sessionId: string, sessionToken: string }
 *
 * Config: verify_jwt = true (authenticated users only)
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

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    // ── Authenticate caller ──────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

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

    // ── Parse request body ───────────────────────────────────────────────
    const { metadata } = await req.json();

    const youverifyApiKey = Deno.env.get('YOUVERIFY_API_KEY');
    const publicMerchantID = Deno.env.get('YOUVERIFY_WEBHOOK_KEY'); // Public Merchant Key from Youverify dashboard
    if (!youverifyApiKey || !publicMerchantID) {
      console.error('[youverify-session] YOUVERIFY_API_KEY or YOUVERIFY_WEBHOOK_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const youverifyHeaders = {
      'Content-Type': 'application/json',
      'Token': youverifyApiKey,
    };

    // ── Step 1: Generate Session ID ──────────────────────────────────────
    const sessionRes = await fetch(
      'https://api.youverify.co/v2/api/identity/sdk/session/generate',
      {
        method: 'POST',
        headers: youverifyHeaders,
        body: JSON.stringify({
          publicMerchantID,
          metadata: metadata || {},
        }),
      },
    );

    if (!sessionRes.ok) {
      const errText = await sessionRes.text();
      console.error('[youverify-session] Session ID generation failed:', sessionRes.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to generate session ID' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const sessionData = await sessionRes.json();
    const sessionId = sessionData.sessionId;

    if (!sessionId) {
      console.error('[youverify-session] No sessionId in response:', JSON.stringify(sessionData));
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid session ID response from provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Step 2: Generate Liveness Session Token ──────────────────────────
    const deviceCorrelationId = crypto.randomUUID();

    const tokenRes = await fetch(
      'https://api.youverify.co/v2/api/identity/sdk/liveness/token',
      {
        method: 'POST',
        headers: youverifyHeaders,
        body: JSON.stringify({
          publicMerchantID,
          deviceCorrelationId,
        }),
      },
    );

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[youverify-session] Liveness token generation failed:', tokenRes.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to generate liveness token' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const tokenData = await tokenRes.json();
    const sessionToken = tokenData.authToken;

    if (!sessionToken) {
      console.error('[youverify-session] No authToken in response:', JSON.stringify(tokenData));
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid liveness token response from provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Return both tokens to the frontend ───────────────────────────────
    console.log(`[youverify-session] Session created for user=${user.id}`);

    return new Response(
      JSON.stringify({ success: true, sessionId, sessionToken }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    console.error('[youverify-session] Unexpected error:', (err as Error).message);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
