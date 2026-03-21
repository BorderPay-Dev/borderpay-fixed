/**
 * BorderPay Africa - Reset Password Screen
 * Password reset with confirmation after email link
 * Mobile-optimized with neon green aesthetic
 * 
 * Features:
 * - Token validation from email link
 * - Password strength meter
 * - Confirm password matching
 * - Success confirmation
 * - Auto-redirect to login
 */

import React, { useState, useEffect } from 'react';
import { SERVER_URL, ANON_KEY } from '../../utils/supabase/client';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Lock, 
  Eye, 
  EyeOff, 
  CheckCircle2, 
  AlertCircle,
  Shield,
  ArrowLeft
} from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../../utils/supabase/info';

interface ResetPasswordScreenProps {
  onNavigateToLogin: () => void;
}

interface PasswordStrength {
  score: number;
  label: string;
  color: string;
}

export function ResetPasswordScreen({ onNavigateToLogin }: ResetPasswordScreenProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [validating, setValidating] = useState(true);
  const [hasValidToken, setHasValidToken] = useState(false);
  const [resetToken, setResetToken] = useState('');

  useEffect(() => {
    validateResetToken();
  }, []);

  const validateResetToken = async () => {
    try {
      // Get token from URL hash
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const token = hashParams.get('token') || hashParams.get('access_token');

      if (!token) {
        toast.error('No reset token found. Please request a new reset link.');
        setHasValidToken(false);
        setValidating(false);
        return;
      }

      // Validate token with backend
      const response = await fetch(`${SERVER_URL}/auth/reset-password/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const data = await response.json();
        console.error('Token validation error:', data);
        toast.error('Invalid or expired reset link');
        setHasValidToken(false);
      } else {
        setResetToken(token);
        setHasValidToken(true);
        // Clear URL hash
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch (error) {
      console.error('Error validating token:', error);
      toast.error('Error validating reset link');
      setHasValidToken(false);
    } finally {
      setValidating(false);
    }
  };

  const calculatePasswordStrength = (password: string): PasswordStrength => {
    let score = 0;
    
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;

    if (score <= 1) return { score, label: 'Weak', color: 'bg-red-500' };
    if (score <= 3) return { score, label: 'Fair', color: 'bg-yellow-500' };
    if (score <= 4) return { score, label: 'Good', color: 'bg-blue-500' };
    return { score, label: 'Strong', color: 'bg-[#C7FF00]' };
  };

  const passwordStrength = calculatePasswordStrength(newPassword);
  const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;
  const canSubmit = newPassword.length >= 8 && passwordsMatch && !loading;

  const handleResetPassword = async () => {
    if (!canSubmit) return;

    setLoading(true);

    try {
      // Call backend to submit new password
      const response = await fetch(`${SERVER_URL}/auth/reset-password/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          access_token: resetToken,
          new_password: newPassword,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        console.error('Password reset error:', data);
        toast.error(data.message || 'Failed to reset password');
        setLoading(false);
        return;
      }

      // Success!
      setSuccess(true);
      toast.success('Password reset successfully!');

      // Auto-redirect after 3 seconds
      setTimeout(() => {
        onNavigateToLogin();
      }, 3000);
    } catch (error: any) {
      console.error('Error resetting password:', error);
      toast.error(error.message || 'Failed to reset password');
      setLoading(false);
    }
  };

  // Loading state while validating token
  if (validating) {
    return (
      <div className="fixed inset-0 bg-[#0B0E11] flex items-center justify-center p-6">
        <div className="glass-gradient-bg" />
        <div className="glass-noise-overlay" />
        <div className="text-center relative z-[2]">
          <div className="w-16 h-16 border-4 border-[#C7FF00] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60 text-sm">Validating reset link...</p>
        </div>
      </div>
    );
  }

  // Invalid token state
  if (!hasValidToken) {
    return (
      <div className="fixed inset-0 bg-[#0B0E11] flex items-center justify-center p-6 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="glass-gradient-bg" />
        <div className="glass-noise-overlay" />
        <div className="max-w-md w-full relative z-[2]">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6"
          >
            <AlertCircle className="w-10 h-10 text-red-500" />
          </motion.div>

          <h1 className="text-2xl font-bold text-white text-center mb-3">
            Invalid Reset Link
          </h1>
          <p className="text-white/60 text-center mb-8">
            This password reset link is invalid or has expired. Please request a new one.
          </p>

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

  // Success state
  if (success) {
    return (
      <div className="fixed inset-0 bg-[#0B0E11] flex items-center justify-center p-6 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="glass-gradient-bg" />
        <div className="glass-noise-overlay" />
        <div className="max-w-md w-full relative z-[2]">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="w-24 h-24 bg-[#C7FF00]/20 rounded-full flex items-center justify-center mx-auto mb-6"
          >
            <CheckCircle2 className="w-12 h-12 text-[#C7FF00]" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-2xl font-bold text-white text-center mb-3"
          >
            Password Reset Successfully!
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-white/60 text-center mb-8"
          >
            Your password has been updated. You can now log in with your new password.
          </motion.p>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex items-center justify-center gap-2 text-sm text-white/40"
          >
            <div className="w-2 h-2 bg-[#C7FF00] rounded-full animate-pulse" />
            Redirecting to login...
          </motion.div>
        </div>
      </div>
    );
  }

  // Reset password form
  return (
    <div className="min-h-[100dvh] max-h-[100dvh] bg-[#0B0E11] text-white flex items-center justify-center px-safe py-safe overflow-hidden fixed inset-0">
      <div className="glass-gradient-bg" />
      <div className="glass-noise-overlay" />
      <div className="w-full max-w-md overflow-y-auto overflow-x-hidden max-h-[100dvh] px-4 py-6 hide-scrollbar relative z-[2]">
        {/* Back Button */}
        <button
          onClick={onNavigateToLogin}
          className="mb-8 flex items-center gap-2 text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm">Back to Login</span>
        </button>

        {/* Header */}
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="w-20 h-20 bg-[#C7FF00]/20 rounded-full flex items-center justify-center mx-auto mb-6"
          >
            <Shield className="w-10 h-10 text-[#C7FF00]" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-2xl font-bold mb-3"
          >
            Reset Your Password
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-white/60 text-sm"
          >
            Choose a strong password to secure your account
          </motion.p>
        </div>

        {/* Form */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="space-y-6"
        >
          {/* New Password */}
          <div>
            <label className="block text-sm font-medium mb-2 text-white/80">
              New Password
            </label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
                <Lock className="w-5 h-5" />
              </div>
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-12 py-4 text-white placeholder-white/40 focus:border-[#C7FF00] focus:outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
              >
                {showNewPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>

            {/* Password Strength Meter */}
            {newPassword && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-white/60">Password Strength</span>
                  <span className={`text-xs font-semibold ${
                    passwordStrength.score >= 4 ? 'text-[#C7FF00]' : 'text-white/60'
                  }`}>
                    {passwordStrength.label}
                  </span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                    className={`h-full ${passwordStrength.color} transition-all duration-300`}
                  />
                </div>
              </motion.div>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium mb-2 text-white/80">
              Confirm Password
            </label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
                <Lock className="w-5 h-5" />
              </div>
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-12 py-4 text-white placeholder-white/40 focus:border-[#C7FF00] focus:outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
              >
                {showConfirmPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>

            {/* Password Match Indicator */}
            <AnimatePresence>
              {confirmPassword && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`mt-2 flex items-center gap-2 text-xs ${
                    passwordsMatch ? 'text-[#C7FF00]' : 'text-red-500'
                  }`}
                >
                  {passwordsMatch ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Passwords match</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4" />
                      <span>Passwords do not match</span>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Password Requirements */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-xs font-semibold text-white/80 mb-3">
              Password must contain:
            </p>
            <div className="space-y-2">
              {[
                { label: 'At least 8 characters', valid: newPassword.length >= 8 },
                { label: 'Uppercase & lowercase letters', valid: /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword) },
                { label: 'At least one number', valid: /\d/.test(newPassword) },
                { label: 'At least one special character', valid: /[^a-zA-Z0-9]/.test(newPassword) },
              ].map((req, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center ${
                    req.valid ? 'bg-[#C7FF00]/20' : 'bg-white/5'
                  }`}>
                    {req.valid && <div className="w-2 h-2 bg-[#C7FF00] rounded-full" />}
                  </div>
                  <span className={`text-xs ${req.valid ? 'text-white/80' : 'text-white/40'}`}>
                    {req.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Submit Button */}
          <motion.button
            whileTap={{ scale: canSubmit ? 0.98 : 1 }}
            onClick={handleResetPassword}
            disabled={!canSubmit}
            className={`w-full py-4 rounded-2xl font-semibold transition-all ${
              canSubmit
                ? 'bg-[#C7FF00] text-black hover:bg-[#B8F000]'
                : 'bg-white/5 text-white/30 cursor-not-allowed'
            }`}
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                <span>Resetting Password...</span>
              </div>
            ) : (
              'Reset Password'
            )}
          </motion.button>
        </motion.div>
      </div>
    </div>
  );
}