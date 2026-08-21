import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { derivePinHashV2, derivePinHashV2FromStored, hashLegacyPin } from '../_shared/security/pin.ts';
import { consumeScaAuthorization } from '../_shared/sca.ts';

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

    const { old_pin, new_pin, sca_authorization_id } = await req.json();
    if (!old_pin || !/^\d{4,6}$/.test(old_pin)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Current PIN must be 4-6 digits' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!new_pin || !/^\d{4,6}$/.test(new_pin)) {
      return new Response(
        JSON.stringify({ success: false, error: 'New PIN must be 4-6 digits' }),
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

    const candidateV2 = storedV2 ? await derivePinHashV2FromStored(old_pin, storedV2) : null;
    const candidateLegacy = storedLegacy ? await hashLegacyPin(old_pin, user.id) : null;
    const newHashV2 = await derivePinHashV2(new_pin);
    const sca = await consumeScaAuthorization({
      supabase,
      authorizationId: sca_authorization_id,
      userId: user.id,
      operation: 'security_change',
      resource: 'change_pin',
      request: { action: 'change_pin' },
    });
    if (!sca.ok) {
      return new Response(JSON.stringify(sca.body), {
        status: sca.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: changeData, error: changeErr } = await supabase.rpc('change_user_pin_atomic', {
      p_user_id: user.id,
      p_candidate_hash_v2: candidateV2,
      p_candidate_hash_legacy: candidateLegacy,
      p_new_hash_v2: newHashV2,
    });
    if (changeErr) {
      return new Response(
        JSON.stringify({ success: false, error: changeErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const row = Array.isArray(changeData) ? changeData[0] : changeData;

    if (row?.changed !== true) {
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
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
