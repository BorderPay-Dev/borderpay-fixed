import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { derivePinHashV2, derivePinHashV2FromStored, hashLegacyPin } from '../_shared/security/pin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'POST only' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { pin } = await req.json();
    if (!pin || !/^\d{4,6}$/.test(pin)) {
      return new Response(
        JSON.stringify({ success: false, error: 'PIN must be 4-6 digits' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: security, error: fetchError } = await supabase
      .from('user_security')
      .select('pin_hash_v2, pin_hash')
      .eq('user_id', user.id)
      .single();

    if (fetchError || !security) {
      return new Response(
        JSON.stringify({ success: false, error: 'PIN not set up' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const storedV2 = typeof security.pin_hash_v2 === 'string' ? security.pin_hash_v2 : '';
    const storedLegacy = typeof security.pin_hash === 'string' ? security.pin_hash : '';
    if (!storedV2 && !storedLegacy) {
      return new Response(
        JSON.stringify({ success: false, error: 'PIN not set up' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const candidateV2 = storedV2 ? await derivePinHashV2FromStored(pin, storedV2) : null;
    const candidateLegacy = storedLegacy ? await hashLegacyPin(pin, user.id) : null;
    const upgradeHashV2 = storedLegacy ? await derivePinHashV2(pin) : null;

    const { data: verifyData, error: verifyErr } = await supabase.rpc('verify_user_pin_atomic', {
      p_user_id: user.id,
      p_candidate_hash_v2: candidateV2,
      p_candidate_hash_legacy: candidateLegacy,
      p_upgrade_hash_v2: upgradeHashV2,
    });
    if (verifyErr) {
      return new Response(
        JSON.stringify({ success: false, error: verifyErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const row = Array.isArray(verifyData) ? verifyData[0] : verifyData;

    if (row?.verified === true) {
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (row?.locked === true) {
      return new Response(
        JSON.stringify({ success: false, error: 'Account locked. Try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (row?.pin_set === false) {
      return new Response(
        JSON.stringify({ success: false, error: 'PIN not set up' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Invalid PIN' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
