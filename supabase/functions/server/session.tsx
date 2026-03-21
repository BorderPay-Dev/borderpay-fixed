/**
 * BorderPay Africa - Session Management
 * 
 * All session data stored in Supabase `profiles` table (session_data JSONB column).
 * No KV store — production-ready Postgres-backed sessions.
 */

import { Hono } from 'npm:hono';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as db from './db.tsx';

const session = new Hono();

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

async function verifyAuth(authHeader: string | null): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  if (!token || token === 'undefined' || token === 'null') return null;

  // Demo tokens -> one_time_tokens table (Postgres)
  if (token.startsWith('demo_token_')) {
    try {
      const tokenRow = await db.getOneTimeToken(token, 'demo_session');
      if (tokenRow?.user_id) {
        if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
          await db.deleteOneTimeToken(tokenRow.id);
          return null;
        }
        return tokenRow.user_id;
      }
      return null;
    } catch { return null; }
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return user.id;
  } catch { return null; }
}

// ── Helpers: read/write session_data from profiles table ──────────────────────

async function getSessionData(userId: string): Promise<any | null> {
  try {
    const profile = await db.getProfileRecord(userId);
    return profile?.session_data || null;
  } catch { return null; }
}

async function setSessionData(userId: string, data: any): Promise<void> {
  await db.upsertProfileRecord({
    user_id: userId,
    session_data: data,
    updated_at: new Date().toISOString(),
  });
}

async function getSessionHistory(userId: string): Promise<any[]> {
  try {
    const profile = await db.getProfileRecord(userId);
    return Array.isArray(profile?.session_history) ? profile.session_history : [];
  } catch { return []; }
}

async function setSessionHistory(userId: string, history: any[]): Promise<void> {
  await db.upsertProfileRecord({
    user_id: userId,
    session_history: history,
    updated_at: new Date().toISOString(),
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /session/update
 */
session.post('/update', async (c) => {
  try {
    const userId = await verifyAuth(c.req.header('Authorization'));
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);

    const { session_info } = await c.req.json();
    if (!session_info) return c.json({ success: false, error: 'Session info required' }, 400);

    const history = await getSessionHistory(userId);
    history.unshift({ ...session_info, session_id: `session_${Date.now()}` });
    const trimmed = history.slice(0, 10);
    await setSessionHistory(userId, trimmed);

    return c.json({ success: true, message: 'Session updated successfully' });
  } catch (error) {
    console.error('Update session error:', error);
    return c.json({ success: false, error: 'Failed to update session' }, 500);
  }
});

/**
 * GET /session/history
 */
session.get('/history', async (c) => {
  try {
    const userId = await verifyAuth(c.req.header('Authorization'));
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);

    const sessionHistory = await getSessionHistory(userId);
    return c.json({ success: true, data: { sessions: sessionHistory } });
  } catch (error) {
    console.error('Get session history error:', error);
    return c.json({ success: false, error: 'Failed to fetch session history' }, 500);
  }
});

/**
 * GET /session/current
 */
session.get('/current', async (c) => {
  try {
    const userId = await verifyAuth(c.req.header('Authorization'));
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);

    const sessionData = await getSessionData(userId);
    return c.json({
      success: true,
      data: {
        session: sessionData || null,
        last_seen: sessionData?.last_activity
          ? new Date(sessionData.last_activity).toISOString()
          : null,
      },
    });
  } catch (error) {
    console.error('Get current session error:', error);
    return c.json({ success: false, error: 'Failed to fetch current session' }, 500);
  }
});

/**
 * POST /session/create
 */
session.post('/create', async (c) => {
  try {
    const userId = await verifyAuth(c.req.header('Authorization'));
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);

    const { user_data, device_info } = await c.req.json();
    const now = Date.now();

    const sessionData = {
      user_id: userId,
      user_data: user_data || {},
      device_info: device_info || {},
      created_at: now,
      last_activity: now,
      expires_at: now + 30 * 60 * 1000,
      onboarding_complete: false,
    };

    await setSessionData(userId, sessionData);
    return c.json({ success: true, message: 'Session created', data: { expires_at: sessionData.expires_at } });
  } catch (error) {
    console.error('Create session error:', error);
    return c.json({ success: false, error: 'Failed to create session' }, 500);
  }
});

/**
 * GET /session/validate
 */
session.get('/validate', async (c) => {
  try {
    const userId = await verifyAuth(c.req.header('Authorization'));
    if (!userId) return c.json({ success: false, error: 'Unauthorized', valid: false }, 401);

    const sessionData = await getSessionData(userId);
    if (!sessionData) {
      return c.json({ success: false, error: 'Session not found', valid: false }, 404);
    }

    const now = Date.now();
    const timeSinceActivity = now - (sessionData.last_activity || 0);
    const thirtyMinutes = 30 * 60 * 1000;

    if (timeSinceActivity > thirtyMinutes) {
      await setSessionData(userId, null);
      return c.json({ success: false, error: 'Session expired', valid: false, expired: true }, 401);
    }

    return c.json({
      success: true,
      valid: true,
      data: {
        user_data: sessionData.user_data,
        last_activity: sessionData.last_activity,
        expires_at: sessionData.expires_at,
        onboarding_complete: sessionData.onboarding_complete,
      },
    });
  } catch (error) {
    console.error('Validate session error:', error);
    return c.json({ success: false, error: 'Failed to validate session', valid: false }, 500);
  }
});

/**
 * POST /session/activity
 */
session.post('/activity', async (c) => {
  try {
    const userId = await verifyAuth(c.req.header('Authorization'));
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);

    let sessionData = await getSessionData(userId);
    const now = Date.now();

    if (!sessionData) {
      sessionData = {
        user_id: userId,
        user_data: {},
        device_info: {},
        created_at: now,
        last_activity: now,
        expires_at: now + 30 * 60 * 1000,
        onboarding_complete: true,
      };
    } else {
      sessionData.last_activity = now;
      sessionData.expires_at = now + 30 * 60 * 1000;
    }

    await setSessionData(userId, sessionData);
    return c.json({
      success: true,
      message: 'Activity timestamp updated',
      data: { last_activity: now, expires_at: sessionData.expires_at },
    });
  } catch (error) {
    console.error('Update activity error:', error);
    return c.json({ success: false, error: 'Failed to update activity' }, 500);
  }
});

/**
 * POST /session/complete-onboarding
 */
session.post('/complete-onboarding', async (c) => {
  try {
    const userId = await verifyAuth(c.req.header('Authorization'));
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);

    const sessionData = await getSessionData(userId);
    if (!sessionData) return c.json({ success: false, error: 'Session not found' }, 404);

    sessionData.onboarding_complete = true;
    await setSessionData(userId, sessionData);

    return c.json({ success: true, message: 'Onboarding marked complete' });
  } catch (error) {
    console.error('Complete onboarding error:', error);
    return c.json({ success: false, error: 'Failed to mark onboarding complete' }, 500);
  }
});

/**
 * POST /session/destroy
 */
session.post('/destroy', async (c) => {
  try {
    const userId = await verifyAuth(c.req.header('Authorization'));
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);

    await setSessionData(userId, null);
    return c.json({ success: true, message: 'Session destroyed' });
  } catch (error) {
    console.error('Destroy session error:', error);
    return c.json({ success: false, error: 'Failed to destroy session' }, 500);
  }
});

export default session;
