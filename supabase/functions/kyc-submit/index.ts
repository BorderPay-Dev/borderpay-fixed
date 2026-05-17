// kyc-submit — REMOVED (legacy provider).
//
// This endpoint was the legacy-provider document-upload KYC submission.
// It has been replaced by the Bridge hosted-link flow:
//   • bridge-customer       — create / fetch the Bridge customer
//   • bridge-kyc-link       — individual hosted KYC link
//   • bridge-kyb-link       — business hosted KYB link
//
// This handler now returns HTTP 410 Gone so any stale caller fails loudly
// instead of silently writing to a dead path. The file is preserved on
// disk per CTO directive ("do not blindly drop files; first remove active
// reads/writes"); the deployed instance can be deleted in the upcoming
// removal pass.

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
  error:   'kyc-submit has been removed. Use bridge-kyc-link / bridge-kyb-link instead.',
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  return new Response(GONE_BODY, { status: 410, headers: CORS });
});
