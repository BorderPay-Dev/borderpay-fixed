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

const FALLBACK_RATES = [
  { source_currency: 'USD', target_currency: 'NGN', rate: 1580.0 },
  { source_currency: 'USD', target_currency: 'KES', rate: 153.5 },
  { source_currency: 'USD', target_currency: 'GHS', rate: 14.8 },
  { source_currency: 'USD', target_currency: 'ZAR', rate: 18.2 },
  { source_currency: 'USD', target_currency: 'UGX', rate: 3780.0 },
  { source_currency: 'USD', target_currency: 'TZS', rate: 2650.0 },
  { source_currency: 'USD', target_currency: 'XOF', rate: 610.0 },
  { source_currency: 'USD', target_currency: 'XAF', rate: 610.0 },
  { source_currency: 'EUR', target_currency: 'NGN', rate: 1720.0 },
  { source_currency: 'GBP', target_currency: 'NGN', rate: 2000.0 },
];

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

    const res = await mapleradFetch('/fx/rates');
    if (!res.ok) {
      return new Response(JSON.stringify({ success: true, data: FALLBACK_RATES, fallback: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await res.json();
    return new Response(JSON.stringify({ success: true, data: body.data ?? body }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: true, data: FALLBACK_RATES, fallback: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
