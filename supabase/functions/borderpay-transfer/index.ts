// borderpay-transfer — REMOVED (legacy provider).
//
// This was the cross-rail transfer orchestrator that proxied a legacy
// provider's payout / collection endpoints. Bridge transfers are now
// handled by:
//   • bridge-transfer       — Bridge fiat / stablecoin orchestration
//
// African local-currency / mobile-wallet payouts are future-state. Until
// BorderPay enables those rails, the client returns rails_future_state.
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
  error:   'borderpay-transfer has been removed. Use the current transfer service for supported rails. African rails are future-state.',
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  return new Response(GONE_BODY, { status: 410, headers: CORS });
});
