// provisioning-request — REMOVED (legacy provider).
//
// This was the unified legacy-provider provisioning router that dispatched
// virtual_account / card / stablecoin / local_currency requests. The
// client (provisioningAPI.request) has been rewired to call Bridge edge
// functions directly:
//   • virtual_account (USD/EUR/GBP) → bridge-virtual-account
//   • stablecoin                    → bridge-wallet
//   • local_currency                → rails_future_state (client-side)
//   • card                          → cards_coming_soon (client-side)
//
// Returns HTTP 410 Gone.

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
  error:   'provisioning-request has been removed. Call bridge-virtual-account / bridge-wallet directly.',
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  return new Response(GONE_BODY, { status: 410, headers: CORS });
});
