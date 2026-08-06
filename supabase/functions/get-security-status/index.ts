import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
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

    const [{ data, error }, { count: biometricCount, error: biometricError }] = await Promise.all([
      supabase
        .from('user_security')
        .select('pin_set, two_factor_enabled, pin_failed_attempts, failed_pin_attempts')
        .eq('user_id', user.id)
        .single(),
      supabase
        .from('webauthn_credentials')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
    ]);

    const biometricEnrolled = !biometricError && Number(biometricCount || 0) > 0;

    if (error || !data) {
      return new Response(
        JSON.stringify({ success: true, data: { pin_set: false, two_factor_enabled: false, biometric_enrolled: biometricEnrolled } }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          pin_set: data.pin_set,
          two_factor_enabled: data.two_factor_enabled,
          biometric_enrolled: biometricEnrolled,
          failed_pin_attempts: data.pin_failed_attempts ?? data.failed_pin_attempts ?? 0,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
