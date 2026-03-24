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

const FALLBACK_PROVIDERS = [
  { name: 'MTN Mobile Money', code: 'mtn', currencies: ['GHS', 'UGX'] },
  { name: 'Vodafone Cash', code: 'vodafone', currencies: ['GHS'] },
  { name: 'AirtelTigo Money', code: 'airteltigo', currencies: ['GHS'] },
  { name: 'M-Pesa', code: 'mpesa', currencies: ['KES', 'TZS'] },
  { name: 'Airtel Money', code: 'airtel', currencies: ['UGX', 'TZS', 'KES'] },
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

    const res = await mapleradFetch('/collections/momo/providers');
    if (!res.ok) {
      return new Response(JSON.stringify({ success: true, data: FALLBACK_PROVIDERS, fallback: true }), {
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
    return new Response(JSON.stringify({ success: true, data: FALLBACK_PROVIDERS, fallback: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
