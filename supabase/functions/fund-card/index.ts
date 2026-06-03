// fund-card — QUARANTINED (Cards locked).
//
// Card issuing and funding are disabled product-wide. The handler now
// returns 501 with a structured `cards_locked` payload so any
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

const LOCKED = JSON.stringify({
  success: false,
  code:    'cards_locked',
  error:   'Cards are locked for your account.',
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return new Response(LOCKED, { status: 501, headers: corsHeaders });
});
