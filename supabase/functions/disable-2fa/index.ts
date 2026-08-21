import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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

    const { password, sca_authorization_id } = await req.json();

    if (!password) {
      return new Response(
        JSON.stringify({ success: false, error: 'Password is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the user's password via Supabase auth
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password,
    });

    if (signInError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: securityState, error: securityStateError } = await supabase
      .from('user_security')
      .select('two_factor_enabled')
      .eq('user_id', user.id)
      .maybeSingle();
    if (securityStateError) throw securityStateError;
    // Cancelling an incomplete enrollment cannot require the factor that has
    // not been enabled. Disabling an active factor always requires full SCA.
    if (securityState?.two_factor_enabled === true) {
      const sca = await consumeScaAuthorization({
        supabase,
        authorizationId: sca_authorization_id,
        userId: user.id,
        operation: 'security_change',
        resource: 'disable_2fa',
        request: { action: 'disable_2fa' },
      });
      if (!sca.ok) {
        return new Response(JSON.stringify(sca.body), {
          status: sca.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Disable 2FA
    const { error: updateError } = await supabase
      .from('user_security')
      .update({
        two_factor_enabled: false,
        two_factor_secret: null,
        two_factor_secret_encrypted: null,
        two_factor_enc_version: null,
        failed_2fa_attempts: 0,
        two_factor_locked_until: null,
      })
      .eq('user_id', user.id);

    if (updateError) {
      return new Response(
        JSON.stringify({ success: false, error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
