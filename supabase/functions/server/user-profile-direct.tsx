/**
 * BorderPay Africa - User Profile Direct Handler
 * 
 * DEDICATED module for user profile operations (financial/sensitive data).
 * This module handles GET/PUT profile, profile picture upload/delete.
 * 
 * Architecture: Frontend -> This Edge Function -> Postgres + Supabase Auth
 * No intermediate middleware layers for profile data.
 * 
 * Created: 2026-03-15 (Phase 1 - API Consolidation)
 */

import { Hono } from 'npm:hono@4';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as db from './db.tsx';
import { initializeUserInDb } from './users.tsx';

const app = new Hono();

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PROFILE_PICTURES_BUCKET = 'make-8714b62b-profile-pictures';

// ============================================================================
// AUTH HELPER
// ============================================================================

async function verifyAuth(authHeader: string | null): Promise<{ userId: string; error?: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];
  if (!token || token === 'undefined' || token === 'null' || token.trim() === '') return null;

  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  if (token === SUPABASE_ANON_KEY) return null;

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) {
      if (error.message?.includes('expired') || error.code === 'bad_jwt') {
        return { userId: '', error: 'TOKEN_EXPIRED' };
      }
      return null;
    }
    if (!user) return null;
    return { userId: user.id };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('expired') || error.message.includes('bad_jwt'))) {
      return { userId: '', error: 'TOKEN_EXPIRED' };
    }
    return null;
  }
}

// ============================================================================
// GET /profile - Full user profile merged from Postgres + Supabase Auth
// ============================================================================

app.get('/profile', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);
    if (auth.error === 'TOKEN_EXPIRED') return c.json({ success: false, error: 'Token expired', code: 'TOKEN_EXPIRED' }, 401);

    let userProfile = await db.getProfile(auth.userId);

    // Auto-heal: if Postgres profile is missing, rebuild from Supabase Auth metadata
    if (!userProfile) {
      console.warn(`[UserProfile] No Postgres profile for ${auth.userId}, auto-healing...`);
      try {
        const { data: { user: authUser }, error: authErr } = await supabase.auth.admin.getUserById(auth.userId);
        if (authErr || !authUser) {
          return c.json({ success: false, error: 'User not found' }, 404);
        }
        const result = await initializeUserInDb(auth.userId, authUser.email!, {
          full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || 'BorderPay User',
          country: authUser.user_metadata?.country || 'UNKNOWN',
          account_type: authUser.user_metadata?.account_type || 'individual',
          phone: authUser.user_metadata?.phone || authUser.phone || '',
          primary_currency: authUser.user_metadata?.primary_currency || 'USD',
        });
        userProfile = result.profile;
        console.log('[UserProfile] Auto-healed from Supabase Auth metadata');
      } catch (healError) {
        console.error('[UserProfile] Auto-heal failed:', healError);
        return c.json({ success: false, error: 'Profile not found and could not be auto-healed' }, 404);
      }
    }

    // Merge with live Supabase Auth data (email, confirmation status, last sign-in)
    try {
      const { data: { user: authUser } } = await supabase.auth.admin.getUserById(auth.userId);
      if (authUser) {
        userProfile = {
          ...userProfile,
          email: authUser.email || userProfile.email,
          email_confirmed: !!authUser.email_confirmed_at,
          last_sign_in_at: authUser.last_sign_in_at || null,
          phone: userProfile.phone || authUser.user_metadata?.phone || authUser.phone || '',
          full_name: userProfile.full_name || authUser.user_metadata?.full_name || authUser.user_metadata?.name || '',
          two_factor_enabled: userProfile.two_factor_enabled ?? (authUser.factors && authUser.factors.length > 0),
        };
      }
    } catch (authMergeError) {
      console.warn('[UserProfile] Could not merge Supabase Auth data:', authMergeError);
    }

    // Refresh profile picture signed URL if path exists but URL is missing
    if (userProfile.profile_picture_path && !userProfile.profile_picture_url) {
      try {
        const { data: signedUrlData } = await supabase.storage
          .from(PROFILE_PICTURES_BUCKET)
          .createSignedUrl(userProfile.profile_picture_path, 31536000);
        if (signedUrlData?.signedUrl) {
          userProfile.profile_picture_url = signedUrlData.signedUrl;
          await db.updateProfile(auth.userId, { profile_picture_url: signedUrlData.signedUrl });
        }
      } catch (picError) {
        console.warn('[UserProfile] Could not refresh profile picture URL:', picError);
      }
    }

    return c.json({ success: true, data: { user: userProfile } });

  } catch (error) {
    console.error('[UserProfile] GET error:', error);
    return c.json({ success: false, error: 'Failed to load profile. Please try again.' }, 500);
  }
});

// ============================================================================
// PUT /profile - Update user profile in Postgres + sync to Supabase Auth
// ============================================================================

app.put('/profile', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);
    if (auth.error === 'TOKEN_EXPIRED') return c.json({ success: false, error: 'Token expired', code: 'TOKEN_EXPIRED' }, 401);

    const body = await c.req.json();
    const userProfile = await db.getProfile(auth.userId);

    if (!userProfile) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Only allow safe fields to be updated
    const allowedFields = ['full_name', 'phone', 'address', 'city', 'country', 'postal_code', 'date_of_birth', 'language', 'timezone'];
    const safeUpdates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) safeUpdates[field] = body[field];
    }

    // 1. Persist to Postgres
    const updatedProfile = await db.updateProfile(auth.userId, safeUpdates);
    console.log('[UserProfile] Updated in Postgres for user:', auth.userId);

    // 2. Sync relevant fields back to Supabase Auth user_metadata
    try {
      await supabase.auth.admin.updateUserById(auth.userId, {
        user_metadata: {
          full_name: updatedProfile.full_name,
          phone: updatedProfile.phone,
          country: updatedProfile.country,
          date_of_birth: updatedProfile.date_of_birth,
          language: updatedProfile.language,
          timezone: updatedProfile.timezone,
        },
      });
      console.log('[UserProfile] Synced to Supabase Auth metadata');
    } catch (syncError) {
      console.warn('[UserProfile] Auth metadata sync failed (non-critical):', syncError);
    }

    return c.json({ success: true, data: { user: updatedProfile } });

  } catch (error) {
    console.error('[UserProfile] PUT error:', error);
    return c.json({ success: false, error: 'Failed to update profile. Please try again.' }, 500);
  }
});

// ============================================================================
// POST /profile-picture - Upload profile picture
// ============================================================================

app.post('/profile-picture', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

    const formData = await c.req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return c.json({ success: false, error: 'No file provided' }, 400);
    }

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return c.json({ success: false, error: 'Invalid file type. Only JPEG, PNG, and WebP images are allowed.' }, 400);
    }

    if (file.size > 5242880) {
      return c.json({ success: false, error: 'File too large. Maximum size is 5MB.' }, 400);
    }

    console.log('[UserProfile] Uploading picture for user:', auth.userId);

    // Delete old profile picture if exists
    const userProfile = await db.getProfile(auth.userId);
    if (userProfile?.profile_picture_path) {
      try {
        await supabase.storage.from(PROFILE_PICTURES_BUCKET).remove([userProfile.profile_picture_path]);
      } catch (error) {
        console.warn('[UserProfile] Could not delete old picture:', error);
      }
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${auth.userId}_${Date.now()}.${fileExt}`;
    const filePath = `profile-pictures/${fileName}`;

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from(PROFILE_PICTURES_BUCKET)
      .upload(filePath, fileBuffer, { contentType: file.type, upsert: true });

    if (uploadError) {
      console.error('[UserProfile] Upload error:', uploadError);
      return c.json({ success: false, error: 'Failed to upload profile picture: ' + uploadError.message }, 500);
    }

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(PROFILE_PICTURES_BUCKET)
      .createSignedUrl(filePath, 31536000);

    if (signedUrlError) {
      return c.json({ success: false, error: 'Failed to generate image URL: ' + signedUrlError.message }, 500);
    }

    await db.updateProfile(auth.userId, {
      profile_picture_url: signedUrlData.signedUrl,
      profile_picture_path: filePath,
    });

    return c.json({
      success: true,
      data: {
        profile_picture_url: signedUrlData.signedUrl,
        message: 'Profile picture uploaded successfully'
      }
    });

  } catch (error) {
    console.error('[UserProfile] Picture upload error:', error);
    return c.json({ success: false, error: 'Failed to upload profile picture. Please try again.' }, 500);
  }
});

// ============================================================================
// DELETE /profile-picture - Delete profile picture
// ============================================================================

app.delete('/profile-picture', async (c) => {
  try {
    const auth = await verifyAuth(c.req.header('Authorization'));
    if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

    const userProfile = await db.getProfile(auth.userId);

    if (!userProfile?.profile_picture_path) {
      return c.json({ success: false, error: 'No profile picture found' }, 404);
    }

    const { error: deleteError } = await supabase.storage
      .from(PROFILE_PICTURES_BUCKET)
      .remove([userProfile.profile_picture_path]);

    if (deleteError) {
      console.error('[UserProfile] Storage delete error:', deleteError);
    }

    await db.updateProfile(auth.userId, {
      profile_picture_url: null,
      profile_picture_path: null,
    });

    return c.json({ success: true, message: 'Profile picture deleted successfully' });

  } catch (error) {
    console.error('[UserProfile] Picture delete error:', error);
    return c.json({ success: false, error: 'Failed to delete profile picture. Please try again.' }, 500);
  }
});

export default app;
