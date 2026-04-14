/**
 * BorderPay Africa — Youverify Liveness Session Generator
 *
 * Generates sessionId and sessionToken required by the youverify-liveness-web
 * SDK on the frontend. These tokens must be created server-side using the
 * Youverify API key.
 *
 * POST body: { metadata?: object }
 * Returns:   { success: true, sessionId, sessionToken, sandbox }
 *
 * TO SWITCH TO PRODUCTION:
 * 1. In Supabase secrets: set YOUVERIFY_ENV=production
 * 2. In Supabase secrets: set YOUVERIFY_API_KEY=[live API key]
 * 3. Redeploy: supabase functions deploy youverify-session
 * That's it. No code changes needed.
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
      console.error('[youverify-session] Auth failed:', authError?.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Parse request body ───────────────────────────────────────────────
    const { metadata } = await req.json();

    // ── Environment config ───────────────────────────────────────────────
    const youverifyEnv = Deno.env.get('YOUVERIFY_ENV') || 'sandbox';
    const isSandbox = youverifyEnv !== 'production';

    const YOUVERIFY_BASE_URL = isSandbox
      ? 'https://api.sandbox.youverify.co'
      : 'https://api.youverify.co';

    const API_KEY = Deno.env.get('YOUVERIFY_API_KEY')
      || Deno.env.get('YOUVERIFY_SECRET_KEY')
      || '';

    const PUBLIC_MERCHANT_ID = Deno.env.get('YOUVERIFY_WEBHOOK_KEY')
      || Deno.env.get('YOUVERIFY_PUBLIC_MERCHANT_KEY')
      || '';

    console.log('[youverify-session] Config:', {
      env: youverifyEnv,
      isSandbox,
      baseUrl: YOUVERIFY_BASE_URL,
      hasApiKey: !!API_KEY,
      hasPublicMerchantId: !!PUBLIC_MERCHANT_ID,
      userId: user.id,
    });

    if (!API_KEY) {
      console.error('[youverify-session] YOUVERIFY_API_KEY not set!');
      return new Response(
        JSON.stringify({ success: false, error: 'Youverify API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!PUBLIC_MERCHANT_ID) {
      console.error('[youverify-session] YOUVERIFY_WEBHOOK_KEY (public merchant ID) not set!');
      return new Response(
        JSON.stringify({ success: false, error: 'Youverify public merchant ID not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const youverifyHeaders = {
      'Content-Type': 'application/json',
      'Token': API_KEY,
    };

    // ── Step 1: Generate Session ID ──────────────────────────────────────
    const sessionUrl = `${YOUVERIFY_BASE_URL}/v2/api/identity/sdk/session/generate`;
    console.log('[youverify-session] Step 1: Calling', sessionUrl);

    const sessionRes = await fetch(sessionUrl, {
      method: 'POST',
      headers: youverifyHeaders,
      body: JSON.stringify({
        publicMerchantID: PUBLIC_MERCHANT_ID,
        metadata: metadata || {},
      }),
    });

    const sessionText = await sessionRes.text();
    console.log('[youverify-session] Step 1 response:', sessionRes.status, sessionText);

    if (!sessionRes.ok) {
      console.error('[youverify-session] Session generation failed:', sessionRes.status, sessionText);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Youverify session generation failed (${sessionRes.status})`,
          details: isSandbox ? sessionText : undefined,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let sessionData: any;
    try {
      sessionData = JSON.parse(sessionText);
    } catch {
      console.error('[youverify-session] Invalid JSON from session endpoint:', sessionText);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid response from Youverify' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const sessionId = sessionData.sessionId || sessionData.data?.sessionId;

    if (!sessionId) {
      console.error('[youverify-session] No sessionId in response:', sessionText);
      return new Response(
        JSON.stringify({ success: false, error: 'No session ID returned from provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Step 2: Generate Liveness Session Token ──────────────────────────
    const deviceCorrelationId = crypto.randomUUID();
    const tokenUrl = `${YOUVERIFY_BASE_URL}/v2/api/identity/sdk/liveness/token`;
    console.log('[youverify-session] Step 2: Calling', tokenUrl);

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: youverifyHeaders,
      body: JSON.stringify({
        publicMerchantID: PUBLIC_MERCHANT_ID,
        deviceCorrelationId,
      }),
    });

    const tokenText = await tokenRes.text();
    console.log('[youverify-session] Step 2 response:', tokenRes.status, tokenText);

    if (!tokenRes.ok) {
      console.error('[youverify-session] Liveness token failed:', tokenRes.status, tokenText);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Youverify liveness token failed (${tokenRes.status})`,
          details: isSandbox ? tokenText : undefined,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let tokenData: any;
    try {
      tokenData = JSON.parse(tokenText);
    } catch {
      console.error('[youverify-session] Invalid JSON from token endpoint:', tokenText);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid response from Youverify' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const sessionToken = tokenData.authToken || tokenData.data?.authToken;

    if (!sessionToken) {
      console.error('[youverify-session] No authToken in response:', tokenText);
      return new Response(
        JSON.stringify({ success: false, error: 'No liveness token returned from provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Return both tokens + sandbox flag to the frontend ────────────────
    console.log(`[youverify-session] Success: user=${user.id}, sessionId=${sessionId}, sandbox=${isSandbox}`);

    return new Response(
      JSON.stringify({ success: true, sessionId, sessionToken, sandbox: isSandbox, publicMerchantKey: PUBLIC_MERCHANT_ID }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    console.error('[youverify-session] Unexpected error:', (err as Error).message, (err as Error).stack);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
