import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAPLERAD_SECRET = Deno.env.get('MAPLERAD_SECRET_KEY_LIVE')!;
const mapleradFetch = (path: string, options: RequestInit = {}) =>
  fetch(`https://api.maplerad.com/v1${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${MAPLERAD_SECRET}`, 'Content-Type': 'application/json', ...options.headers },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { card_id, amount, wallet_currency } = await req.json();

    if (!card_id || !amount) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required fields: card_id, amount' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (amount <= 0) {
      return new Response(JSON.stringify({ success: false, error: 'Amount must be greater than zero' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fundBody: Record<string, unknown> = {
      amount: Math.round(amount * 100), // amount in minor units (cents/kobo)
    };

    if (wallet_currency) {
      fundBody.currency = wallet_currency.toUpperCase();
    }

    const res = await mapleradFetch(`/issuing/${card_id}/fund`, {
      method: 'POST',
      body: JSON.stringify(fundBody),
    });

    const body = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ success: false, error: body.message || 'Failed to fund card' }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, data: body.data ?? body }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
