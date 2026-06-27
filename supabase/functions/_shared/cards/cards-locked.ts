import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function lockedBody(action: string) {
  return JSON.stringify({
    success: false,
    code: 'cards_locked',
    error: 'Cards are locked for your account.',
    data: {
      locked: true,
      action,
      program: {
        network: 'VISA',
        status: 'locked',
        reason: 'program_not_enabled',
      },
      capabilities: {
        issue_card: false,
        fund_card: false,
        withdraw_card: false,
        freeze_card: false,
        terminate_card: false,
        card_transactions: false,
        spending_controls: false,
        statements: false,
      },
    },
  });
}

export function serveCardsLocked(action: string) {
  const payload = lockedBody(action);
  serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    return new Response(payload, { status: 501, headers: CORS });
  });
}

