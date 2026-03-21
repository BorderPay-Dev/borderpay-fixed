/**
 * BorderPay Africa - Session Management API
 * Handles authentication sessions via KV store backend
 */

import { supabase } from '../supabase/client';

import { SERVER_URL } from '../supabase/client';
const BASE_URL = `${SERVER_URL}/session`;

/**
 * Get access token for authenticated requests
 */
async function getAccessToken(): Promise<string | null> {
  try {
    // Supabase v2: getSession() is async
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data?.session?.access_token || null;
  } catch (error) {
    console.error('❌ SessionAPI: Failed to get access token:', error);
    return null;
  }
}

/**
 * Create authentication session after login/signup
 */
export async function createSession(userData: {
  id: string;
  email: string;
  full_name: string;
}): Promise<{ success: boolean; error?: string; expires_at?: number }> {
  try {
    const token = await getAccessToken();
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    const deviceInfo = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      timestamp: Date.now(),
    };

    const response = await fetch(`${BASE_URL}/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      },
      body: JSON.stringify({
        user_data: userData,
        device_info: deviceInfo,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('❌ SessionAPI: Create session failed:', result);
      return { success: false, error: result.error || 'Failed to create session' };
    }

    console.log('✅ SessionAPI: Session created successfully');
    
    // Store user data in localStorage for quick access
    localStorage.setItem('borderpay_user', JSON.stringify(userData));

    return { 
      success: true, 
      expires_at: result.data?.expires_at,
    };
  } catch (error) {
    console.error('❌ SessionAPI: Create session error:', error);
    return { success: false, error: 'Network error' };
  }
}

/**
 * Validate current session
 */
export async function validateSession(): Promise<{
  success: boolean;
  valid: boolean;
  expired?: boolean;
  onboarding_complete?: boolean;
  user_data?: any;
  error?: string;
}> {
  try {
    const token = await getAccessToken();
    if (!token) {
      console.log('ℹ️ SessionAPI: No access token found');
      return { success: false, valid: false, error: 'Not authenticated' };
    }

    console.log('🔍 SessionAPI: Validating session with backend...');
    
    const response = await fetch(`${BASE_URL}/validate`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      },
    });

    const result = await response.json();

    if (!response.ok) {
      if (result.expired) {
        console.log('⏱️ SessionAPI: Session expired');
        return { success: false, valid: false, expired: true };
      }
      
      console.warn('⚠️ SessionAPI: Session validation failed:', result);
      return { success: false, valid: false, error: result.error };
    }

    console.log('✅ SessionAPI: Session valid');

    return {
      success: true,
      valid: true,
      onboarding_complete: result.data?.onboarding_complete || false,
      user_data: result.data?.user_data,
    };
  } catch (error) {
    console.error('❌ SessionAPI: Validate session error:', error);
    return { success: false, valid: false, error: 'Network error' };
  }
}

/**
 * Update session activity timestamp (called on user interaction)
 */
export async function updateActivity(): Promise<{ success: boolean; error?: string }> {
  try {
    const token = await getAccessToken();
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    const response = await fetch(`${BASE_URL}/activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      },
    });

    const result = await response.json();

    if (!response.ok) {
      console.warn('⚠️ SessionAPI: Update activity failed:', result);
      return { success: false, error: result.error };
    }

    // Silent success - don't log to avoid console spam
    return { success: true };
  } catch (error) {
    console.error('❌ SessionAPI: Update activity error:', error);
    return { success: false, error: 'Network error' };
  }
}

/**
 * Mark onboarding as complete
 */
export async function completeOnboarding(): Promise<{ success: boolean; error?: string }> {
  try {
    const token = await getAccessToken();
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    const response = await fetch(`${BASE_URL}/complete-onboarding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      },
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('❌ SessionAPI: Complete onboarding failed:', result);
      return { success: false, error: result.error };
    }

    console.log('✅ SessionAPI: Onboarding marked complete');
    
    // Also mark in localStorage as backup
    localStorage.setItem('borderpay_onboarding_complete', 'true');

    return { success: true };
  } catch (error) {
    console.error('❌ SessionAPI: Complete onboarding error:', error);
    return { success: false, error: 'Network error' };
  }
}

/**
 * Destroy session (logout)
 */
export async function destroySession(): Promise<{ success: boolean; error?: string }> {
  try {
    const token = await getAccessToken();
    if (!token) {
      // Even if not authenticated, clear local data
      clearLocalSessionData();
      return { success: true };
    }

    const response = await fetch(`${BASE_URL}/destroy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      },
    });

    const result = await response.json();

    if (!response.ok) {
      console.warn('⚠️ SessionAPI: Destroy session failed:', result);
      // Still clear local data even if backend fails
      clearLocalSessionData();
      return { success: false, error: result.error };
    }

    console.log('✅ SessionAPI: Session destroyed');
    
    // Clear local session data
    clearLocalSessionData();

    return { success: true };
  } catch (error) {
    console.error('❌ SessionAPI: Destroy session error:', error);
    // Still clear local data even if network fails
    clearLocalSessionData();
    return { success: false, error: 'Network error' };
  }
}

/**
 * Clear local session data (localStorage)
 */
function clearLocalSessionData() {
  localStorage.removeItem('borderpay_user');
  localStorage.removeItem('borderpay_user_id');
  localStorage.removeItem('borderpay_token');
  localStorage.removeItem('borderpay_onboarding_complete');
  localStorage.removeItem('borderpay_last_activity');
}

/**
 * Get stored user data (from localStorage)
 * This is a lightweight read for UI purposes only
 * Always validate with backend for critical operations
 */
export function getStoredUserData(): { id: string; email: string; full_name: string } | null {
  try {
    const userData = localStorage.getItem('borderpay_user');
    if (!userData) return null;
    
    return JSON.parse(userData);
  } catch (error) {
    console.error('❌ SessionAPI: Failed to get stored user data:', error);
    return null;
  }
}

export const sessionAPI = {
  create: createSession,
  validate: validateSession,
  updateActivity: updateActivity,
  completeOnboarding: completeOnboarding,
  destroy: destroySession,
  getStoredUserData,
};