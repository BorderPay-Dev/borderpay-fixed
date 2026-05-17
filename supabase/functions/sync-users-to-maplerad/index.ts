// sync-users-to-maplerad — REMOVED (Maplerad legacy).
//
// This batch job previously pushed KYC-approved users into Maplerad as
// customers. Bridge customer creation is now lazy and per-user, triggered
// only when the user starts KYC/KYB via bridge-customer / bridge-kyc-link
// / bridge-kyb-link. There is no background sync job for Bridge.
//
// Existing Maplerad customers are NOT migrated. This endpoint returns
// HTTP 410 Gone for any cron / admin / accidental invocation.

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
  error:   'sync-users-to-maplerad has been removed. Bridge customers are created lazily at KYC start; no background sync job exists.',
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  return new Response(GONE_BODY, { status: 410, headers: CORS });
});
