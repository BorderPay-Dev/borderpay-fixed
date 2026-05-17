// fund-card — QUARANTINED LEGACY (Cards Coming Soon).
//
// This function previously proxied a legacy-provider card-fund call.
// Card issuance and funding are paused product-wide. The handler now
// returns 501 with a structured `cards_coming_soon` payload so any
// deployed-but-unused caller fails loudly.
//
// No legacy provider client is imported here.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json',
};

const COMING_SOON = JSON.stringify({
  success: false,
  code:    'cards_coming_soon',
  error:   'Cards are Coming Soon',
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return new Response(COMING_SOON, { status: 501, headers: corsHeaders });
});
