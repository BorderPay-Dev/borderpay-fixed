/**
 * BorderPay Africa - User Preferences Routes
 * User preferences stored in Postgres `profiles` table (durable)
 * 
 * MIGRATED from ephemeral store → profiles table (preferences JSONB column)
 */

import { Hono } from 'npm:hono@4';
import * as db from './db.tsx';

interface UserPreferences {
  user_id: string;
  theme: 'dark' | 'light' | 'auto';
  language: string;
  currency_display: string;
  hide_balance: boolean;
  biometric_enabled: boolean;
  pin_enabled: boolean;
  auto_lock_timeout: number;
  show_transaction_notifications: boolean;
  sound_enabled: boolean;
  haptic_enabled: boolean;
  face_id_enabled: boolean;
  touch_id_enabled: boolean;
  dashboard_widgets: string[];
  preferred_payment_method?: string;
  created_at: string;
  updated_at: string;
}

const DEFAULT_PREFERENCES: Omit<UserPreferences, 'user_id' | 'created_at' | 'updated_at'> = {
  theme: 'dark',
  language: 'en',
  currency_display: 'USD',
  hide_balance: false,
  biometric_enabled: false,
  pin_enabled: true,
  auto_lock_timeout: 5,
  show_transaction_notifications: true,
  sound_enabled: true,
  haptic_enabled: true,
  face_id_enabled: false,
  touch_id_enabled: false,
  dashboard_widgets: ['balance', 'recent_transactions', 'quick_actions'],
};

export function createPreferencesRoutes(app: Hono, verifyAuth: any) {

  /**
   * GET /preferences
   */
  app.get('/make-server-8714b62b/preferences', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      console.log('⚙️ Getting preferences for user:', auth.userId);

      const profileRecord = await db.getProfileRecord(auth.userId);
      const preferences = profileRecord?.preferences || null;

      const defaultPreferences: UserPreferences = {
        ...DEFAULT_PREFERENCES,
        user_id: auth.userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return c.json({
        success: true,
        data: { preferences: preferences || defaultPreferences }
      });
    } catch (error) {
      console.error('❌ Get preferences error:', error);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  });

  /**
   * PUT /preferences
   */
  app.put('/make-server-8714b62b/preferences', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      const updates = await c.req.json();
      console.log('⚙️ Updating preferences for user:', auth.userId);

      // Get current preferences or create defaults
      const profileRecord = await db.getProfileRecord(auth.userId);
      let preferences = profileRecord?.preferences || {
        ...DEFAULT_PREFERENCES,
        user_id: auth.userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Validate and update fields
      if (updates.theme !== undefined) {
        if (!['dark', 'light', 'auto'].includes(updates.theme)) {
          return c.json({ success: false, error: 'Invalid theme. Must be dark, light, or auto' }, 400);
        }
        preferences.theme = updates.theme;
      }
      if (updates.language !== undefined) preferences.language = updates.language;
      if (updates.currency_display !== undefined) preferences.currency_display = updates.currency_display;
      if (updates.hide_balance !== undefined) preferences.hide_balance = updates.hide_balance;
      if (updates.biometric_enabled !== undefined) preferences.biometric_enabled = updates.biometric_enabled;
      if (updates.pin_enabled !== undefined) preferences.pin_enabled = updates.pin_enabled;
      if (updates.auto_lock_timeout !== undefined) {
        if (updates.auto_lock_timeout < 1 || updates.auto_lock_timeout > 60) {
          return c.json({ success: false, error: 'Auto-lock timeout must be between 1 and 60 minutes' }, 400);
        }
        preferences.auto_lock_timeout = updates.auto_lock_timeout;
      }
      if (updates.show_transaction_notifications !== undefined) preferences.show_transaction_notifications = updates.show_transaction_notifications;
      if (updates.sound_enabled !== undefined) preferences.sound_enabled = updates.sound_enabled;
      if (updates.haptic_enabled !== undefined) preferences.haptic_enabled = updates.haptic_enabled;
      if (updates.face_id_enabled !== undefined) preferences.face_id_enabled = updates.face_id_enabled;
      if (updates.touch_id_enabled !== undefined) preferences.touch_id_enabled = updates.touch_id_enabled;
      if (updates.dashboard_widgets !== undefined) {
        if (!Array.isArray(updates.dashboard_widgets)) {
          return c.json({ success: false, error: 'dashboard_widgets must be an array' }, 400);
        }
        preferences.dashboard_widgets = updates.dashboard_widgets;
      }
      if (updates.preferred_payment_method !== undefined) preferences.preferred_payment_method = updates.preferred_payment_method;

      preferences.updated_at = new Date().toISOString();

      // Save to profiles table
      await db.upsertProfileRecord({
        user_id: auth.userId,
        preferences,
        updated_at: new Date().toISOString(),
      });

      console.log('✅ Preferences updated successfully');

      return c.json({
        success: true,
        message: 'Preferences updated successfully',
        data: { preferences }
      });
    } catch (error) {
      console.error('❌ Update preferences error:', error);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  });

  /**
   * DELETE /preferences
   */
  app.delete('/make-server-8714b62b/preferences', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      console.log('⚙️ Resetting preferences for user:', auth.userId);

      // Clear preferences in profiles table (set to null → will use defaults on next GET)
      try {
        await db.upsertProfileRecord({
          user_id: auth.userId,
          preferences: null,
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('Could not reset preferences in profiles table:', e);
      }

      console.log('✅ Preferences reset to defaults');

      return c.json({ success: true, message: 'Preferences reset to defaults' });
    } catch (error) {
      console.error('❌ Reset preferences error:', error);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  });

  /**
   * GET /preferences/widgets
   */
  app.get('/make-server-8714b62b/preferences/widgets', async (c) => {
    try {
      const auth = await verifyAuth(c.req.header('Authorization'));
      if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

      const availableWidgets = [
        { id: 'balance', name: 'Balance Overview', description: 'Total balance across all wallets' },
        { id: 'recent_transactions', name: 'Recent Transactions', description: 'Latest transaction activity' },
        { id: 'quick_actions', name: 'Quick Actions', description: 'Fast access to common features' },
        { id: 'exchange_rates', name: 'Exchange Rates', description: 'Real-time currency rates' },
        { id: 'savings_goals', name: 'Savings Goals', description: 'Track your savings progress' },
        { id: 'spending_insights', name: 'Spending Insights', description: 'AI-powered spending analysis' },
        { id: 'scheduled_payments', name: 'Scheduled Payments', description: 'Upcoming recurring transfers' },
      ];

      return c.json({ success: true, data: { widgets: availableWidgets } });
    } catch (error) {
      console.error('❌ Get widgets error:', error);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  });

  return app;
}