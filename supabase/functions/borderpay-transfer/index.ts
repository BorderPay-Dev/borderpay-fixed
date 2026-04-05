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

async function hashPin(pin: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + salt);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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

    const { recipient_email, amount, currency, note, transaction_pin } = await req.json();

    if (!recipient_email || !amount || !currency) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required fields: recipient_email, amount, currency' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!transaction_pin) {
      return new Response(JSON.stringify({ success: false, error: 'Transaction PIN is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Verify transaction PIN against stored hash ──────────────────────────
    const { data: security, error: secError } = await supabase
      .from('user_security')
      .select('pin_hash, failed_pin_attempts, pin_locked_until')
      .eq('user_id', user.id)
      .single();

    if (secError || !security?.pin_hash) {
      return new Response(JSON.stringify({ success: false, error: 'PIN not set up. Please set a transaction PIN first.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (security.pin_locked_until && new Date(security.pin_locked_until) > new Date()) {
      return new Response(JSON.stringify({ success: false, error: 'Account locked due to too many failed PIN attempts. Try again later.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pinHash = await hashPin(String(transaction_pin), user.id);
    if (pinHash !== security.pin_hash) {
      const newAttempts = (security.failed_pin_attempts || 0) + 1;
      const updateData: Record<string, unknown> = { failed_pin_attempts: newAttempts };
      if (newAttempts >= 5) {
        updateData.pin_locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      await supabase.from('user_security').update(updateData).eq('user_id', user.id);
      return new Response(JSON.stringify({ success: false, error: 'Invalid PIN' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Reset failed attempts on success
    await supabase.from('user_security').update({ failed_pin_attempts: 0, pin_locked_until: null }).eq('user_id', user.id);

    // Look up recipient
    const { data: recipient, error: recipientError } = await supabase
      .from('user_profiles')
      .select('id, email, full_name, maplerad_customer_id')
      .eq('email', recipient_email)
      .single();

    if (recipientError || !recipient) {
      return new Response(JSON.stringify({ success: false, error: 'Recipient not found on BorderPay' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (recipient.id === user.id) {
      return new Response(JSON.stringify({ success: false, error: 'Cannot transfer to yourself' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get sender profile
    const { data: sender, error: senderError } = await supabase
      .from('user_profiles')
      .select('maplerad_customer_id')
      .eq('id', user.id)
      .single();

    if (senderError || !sender?.maplerad_customer_id) {
      return new Response(JSON.stringify({ success: false, error: 'Sender profile not found or not linked to Maplerad' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Call Maplerad transfer API
    const transferRes = await mapleradFetch('/transfers', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: sender.maplerad_customer_id,
        recipient_id: recipient.maplerad_customer_id,
        amount: Math.round(amount * 100), // amount in kobo/cents
        currency: currency.toUpperCase(),
        reason: note || 'BorderPay P2P transfer',
      }),
    });

    const transferBody = await transferRes.json();

    if (!transferRes.ok) {
      // Fallback: record the transaction locally
      const { data: txRecord, error: txError } = await supabase
        .from('transactions')
        .insert({
          user_id: user.id,
          type: 'p2p_transfer',
          amount,
          currency: currency.toUpperCase(),
          status: 'pending',
          recipient_email,
          recipient_id: recipient.id,
          note: note || null,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      return new Response(JSON.stringify({
        success: true,
        data: {
          transfer_id: txRecord?.id || null,
          status: 'pending',
          note: 'Recorded locally; Maplerad transfer pending',
        },
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        transfer_id: transferBody.data?.id || transferBody.id,
        status: transferBody.data?.status || 'processing',
      },
    }), {
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
