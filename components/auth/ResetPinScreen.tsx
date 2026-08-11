import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, Lock, Shield } from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { toast } from 'sonner';
import { friendlyError } from '../../utils/errors/friendlyError';
import { clearAppLocked } from '../../utils/supabase/client';

interface ResetPinScreenProps {
  onNavigateToLogin: () => void;
  onResetComplete?: () => void;
}

export function ResetPinScreen({ onNavigateToLogin, onResetComplete }: ResetPinScreenProps) {
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showNewPin, setShowNewPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const token = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    const fromQuery = q.get('token');
    if (fromQuery) return fromQuery;
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return h.get('token') || '';
  }, []);

  const isPinValid = /^\d{6}$/.test(newPin);
  const pinsMatch = newPin.length > 0 && newPin === confirmPin;

  useEffect(() => {
    if (token) return;
    toast.error('Invalid or expired PIN reset link');
  }, [token]);

  const handleSubmit = async () => {
    if (!token) return;
    if (!isPinValid) {
      toast.error('PIN must be exactly 6 digits');
      return;
    }
    if (!pinsMatch) {
      toast.error('PINs do not match');
      return;
    }
    setLoading(true);
    try {
      const r: any = await backendAPI.auth.confirmPinReset(token, newPin);
      if (!r?.success) {
        toast.error(friendlyError(r?.error, 'Unable to reset PIN'));
        return;
      }
      // PIN reset is server-authoritative. Remove the obsolete device-local
      // PIN hash left by pre-migration clients so it cannot reject the newly
      // reset PIN before the request reaches verify-pin.
      const resetUserId = String(r?.data?.user_id || '');
      if (resetUserId) {
        try { localStorage.removeItem(`borderpay_security_${resetUserId}`); } catch { /* non-blocking */ }
      }
      try {
        const cached = localStorage.getItem('borderpay_user');
        if (cached) {
          const profile = JSON.parse(cached);
          profile.pin_set = true;
          localStorage.setItem('borderpay_user', JSON.stringify(profile));
        }
      } catch { /* non-blocking */ }
      clearAppLocked();
      setSuccess(true);
      toast.success('PIN reset successful');
      // Clearing localStorage alone does not clear App.tsx's in-memory lock.
      // Let the root router clear that state before returning to login.
      setTimeout(() => (onResetComplete || onNavigateToLogin)(), 1200);
    } catch (e) {
      toast.error(friendlyError(e, 'Unable to reset PIN'));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="fixed inset-0 bg-[#0B0E11] flex items-center justify-center p-6 overflow-y-auto">
        <div className="glass-gradient-bg" />
        <div className="glass-noise-overlay" />
        <div className="max-w-md w-full relative z-[2]">
          <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-white text-center mb-3">Invalid Reset Link</h1>
          <p className="text-white/60 text-center mb-8">This PIN reset link is invalid or has expired.</p>
          <button
            onClick={onNavigateToLogin}
            className="w-full bg-[#C7FF00] text-black font-semibold py-4 rounded-2xl hover:bg-[#B8F000] transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="fixed inset-0 bg-[#0B0E11] flex items-center justify-center p-6 overflow-y-auto">
        <div className="glass-gradient-bg" />
        <div className="glass-noise-overlay" />
        <div className="max-w-md w-full relative z-[2]">
          <div className="w-24 h-24 bg-[#C7FF00]/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-12 h-12 text-[#C7FF00]" />
          </div>
          <h1 className="text-2xl font-bold text-white text-center mb-3">PIN Reset Successfully</h1>
          <p className="text-white/60 text-center">Redirecting you to login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] max-h-[100dvh] bg-[#0B0E11] text-white flex items-center justify-center px-safe py-safe overflow-hidden fixed inset-0">
      <div className="glass-gradient-bg" />
      <div className="glass-noise-overlay" />
      <div className="w-full max-w-md overflow-y-auto overflow-x-hidden max-h-[100dvh] px-4 py-6 hide-scrollbar relative z-[2]">
        <button onClick={onNavigateToLogin} className="mb-8 flex items-center gap-2 text-white/60 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm">Back to Login</span>
        </button>

        <div className="text-center mb-10">
          <div className="w-20 h-20 bg-[#C7FF00]/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <Shield className="w-10 h-10 text-[#C7FF00]" />
          </div>
          <h1 className="text-2xl font-bold mb-3">Set New PIN</h1>
          <p className="text-white/60 text-sm">Choose a new 6-digit transaction PIN</p>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2 text-white/80">New PIN</label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
                <Lock className="w-5 h-5" />
              </div>
              <input
                type={showNewPin ? 'text' : 'password'}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-12 py-4 text-white placeholder-white/40 focus:border-[#C7FF00] focus:outline-none transition-all"
                placeholder="••••••"
                inputMode="numeric"
              />
              <button type="button" onClick={() => setShowNewPin((v) => !v)} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40">
                {showNewPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-white/80">Confirm PIN</label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
                <Lock className="w-5 h-5" />
              </div>
              <input
                type={showConfirmPin ? 'text' : 'password'}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-12 py-4 text-white placeholder-white/40 focus:border-[#C7FF00] focus:outline-none transition-all"
                placeholder="••••••"
                inputMode="numeric"
              />
              <button type="button" onClick={() => setShowConfirmPin((v) => !v)} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40">
                {showConfirmPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || !isPinValid || !pinsMatch}
            className="w-full bg-[#C7FF00] text-black font-semibold py-4 rounded-2xl hover:bg-[#B8F000] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Resetting...' : 'Reset PIN'}
          </button>
        </div>
      </div>
    </div>
  );
}
