/**
 * BorderPay Africa - Session Management API
 * Handles authentication sessions via backend
 */

import { supabase, BASE_URL as FUNCTIONS_URL } from '../supabase/client';

const BASE_URL = `${FUNCTIONS_URL}/session`;

async function getAccessToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

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
      return { success: false, error: result.error || 'Failed to create session' };
    }

    localStorage.setItem('borderpay_user', JSON.stringify(userData));

    return {
      success: true,
      expires_at: result.data?.expires_at,
    };
  } catch {
    return { success: false, error: 'Network error' };
  }
}

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
      return { success: false, valid: false, error: 'Not authenticated' };
    }

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
        return { success: false, valid: false, expired: true };
      }
      return { success: false, valid: false, error: result.error };
    }

    return {
      success: true,
      valid: true,
      onboarding_complete: result.data?.onboarding_complete || false,
      user_data: result.data?.user_data,
    };
  } catch {
    return { success: false, valid: false, error: 'Network error' };
  }
}

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
      return { success: false, error: result.error };
    }

    return { success: true };
  } catch {
    return { success: false, error: 'Network error' };
  }
}

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
      return { success: false, error: result.error };
    }

    localStorage.setItem('borderpay_onboarding_complete', 'true');
    return { success: true };
  } catch {
    return { success: false, error: 'Network error' };
  }
}

export async function destroySession(): Promise<{ success: boolean; error?: string }> {
  try {
    const token = await getAccessToken();
    if (!token) {
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

    await response.json();
    clearLocalSessionData();

    if (!response.ok) {
      return { success: false, error: 'Session destroy failed' };
    }

    return { success: true };
  } catch {
    clearLocalSessionData();
    return { success: false, error: 'Network error' };
  }
}

function clearLocalSessionData() {
  localStorage.removeItem('borderpay_user');
  localStorage.removeItem('borderpay_user_id');
  localStorage.removeItem('borderpay_token');
  localStorage.removeItem('borderpay_onboarding_complete');
  localStorage.removeItem('borderpay_last_activity');
}

export function getStoredUserData(): { id: string; email: string; full_name: string } | null {
  try {
    const userData = localStorage.getItem('borderpay_user');
    if (!userData) return null;
    return JSON.parse(userData);
  } catch {
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
