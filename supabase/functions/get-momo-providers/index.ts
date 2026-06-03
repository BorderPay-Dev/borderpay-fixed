// get-momo-providers — REMOVED (legacy provider).
//
// Mobile-wallet collection is a future-state African rail. This endpoint
// returns HTTP 410 Gone. The
// client (mobileMoneyAPI.getProviders) returns rails_future_state directly
// without invoking this endpoint.

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
  error:   'get-momo-providers has been removed. Mobile money is future-state.',
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  return new Response(GONE_BODY, { status: 410, headers: CORS });
});
