// get-fx-rates — REMOVED (legacy provider).
//
// This endpoint proxied a legacy provider's FX rate feed. The replacement
// FX source has not yet been wired (planned: Bridge FX or a neutral feed).
// Until that ships, this endpoint returns HTTP 410 Gone. The dashboard rate
// widget gracefully falls back to its FALLBACK_PAIRS constants when the
// network call fails.
//
// CurrencyConverter will surface the failure to the user — acceptable as a
// short-term gap; tracked as a launch blocker in the removal report.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json',
};

const GONE_BODY = JSON.stringify({
  success: false,
  code:    'provider_removed',
  error:   'get-fx-rates has been removed. A replacement FX rate feed is pending.',
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  return new Response(GONE_BODY, { status: 410, headers: CORS });
});
