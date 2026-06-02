// auth-reset-password-confirm — verify a GoTrue recovery token and set a new
// password. Brought into source control for P0-b at deployed parity (v103).
//
// P0-b makes NO behavioural change here. It is included for source/deployed
// parity only; deployment of this function is a SEPARATE, explicitly-gated step
// (do not deploy as part of the auth-reset-password email-logging change).
//
// Behaviour (unchanged from deployed v103):
//   • Verify the recovery access_token by reading the user via GoTrue.
//   • Update the password via the admin API (min 8 chars).
//   • Preserve 2FA / PIN: user_security is left untouched.
//   • Generic error messages (no account-existence leakage).
//
// Deploy (separate gated step — NOT part of P0-b email logging):
//   supabase functions deploy auth-reset-password-confirm --project-ref orwrcpwsffjlvzuraxjc

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { access_token, new_password } = await req.json();

    if (!access_token || !new_password) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token and new password are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (new_password.length < 8) {
      return new Response(
        JSON.stringify({ success: false, error: 'Password must be at least 8 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_KEY') || '';

    // First, verify the token by creating a client with it
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${access_token}` } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser(access_token);

    if (userError || !userData?.user) {
      console.error('Token verification failed:', userError);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired reset token. Please request a new one.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use admin API to update the password
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      userData.user.id,
      { password: new_password }
    );

    if (updateError) {
      console.error('Password update failed:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update password. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Preserve 2FA and security settings — do NOT reset them
    // The user_security table is untouched, so PIN and 2FA remain intact

    console.log(`Password reset successful for user ${userData.user.id}`);

    return new Response(
      JSON.stringify({ success: true, message: 'Password has been reset successfully.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('auth-reset-password-confirm error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Unable to reset password. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
