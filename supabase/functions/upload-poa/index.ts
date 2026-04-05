/**
 * BorderPay Africa — Upload Proof of Address
 * Accepts multipart FormData: file + document_type
 * Uploads to poa-documents bucket, records in address_verifications,
 * updates user_profiles.address_verification_status = 'pending'
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

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

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const document_type = formData.get('document_type') as string | null;

    if (!file || !document_type) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing file or document_type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (file.size > MAX_SIZE) {
      return new Response(
        JSON.stringify({ success: false, error: 'File too large. Maximum 10MB.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate MIME type
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const validExts = ['jpg', 'jpeg', 'png', 'pdf'];
    if (!ALLOWED_TYPES.includes(file.type) && !validExts.includes(ext)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid file type. Only JPG, PNG, PDF allowed.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fileName = `${user.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const fileBytes = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from('poa-documents')
      .upload(fileName, fileBytes, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Upload failed: ' + uploadError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Record in address_verifications (best effort)
    await supabase.from('address_verifications').insert({
      user_id: user.id,
      file_path: fileName,
      document_type,
      status: 'pending',
      created_at: new Date().toISOString(),
    }).catch(() => {});

    // Update user profile status
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ address_verification_status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (updateError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update verification status' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data: { status: 'pending', file_path: fileName } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
