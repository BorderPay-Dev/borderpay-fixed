import { BorderPayLogo } from '../cards/BorderPayLogo';

import React, { useState } from 'react';
import { SERVER_URL, ANON_KEY } from '../../utils/supabase/client';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ArrowLeft, Mail, CheckCircle } from 'lucide-react';
import { projectId } from '../../utils/supabase/info';

/**
 * BorderPay Africa - Forgot Password Component
 * Send password reset email via backend Edge Function
 * Neon green + black aesthetic, mobile-first
 */

interface Props {
  onNavigateToLogin: () => void;
  onNavigateToResetPassword?: () => void;
}

export function ForgotPassword({ onNavigateToLogin, onNavigateToResetPassword }: Props) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!email) {
      setError('Email is required');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Invalid email format');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${SERVER_URL}/auth/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to send reset email. Please try again.');
      }

      setSuccess(true);
      console.log('✅ Password reset email sent to:', email);
    } catch (err: any) {
      console.error('❌ Password reset error:', err);
      
      // User-friendly error messages
      if (err.message?.includes('User not found')) {
        setError('No account found with this email address');
      } else if (err.message?.includes('Email rate limit exceeded')) {
        setError('Too many requests. Please try again later');
      } else {
        setError(err.message || 'Failed to send reset email. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] max-h-[100dvh] bg-[#0B0E11] text-white flex items-center justify-center px-safe py-safe overflow-hidden fixed inset-0">
      <div className="glass-gradient-bg" />
      <div className="glass-noise-overlay" />
      <div className="w-full max-w-md overflow-y-auto overflow-x-hidden max-h-[100dvh] px-4 py-6 hide-scrollbar relative z-[2]">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <BorderPayLogo size={80} color="#000000" className="rounded-[30px]" />
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Reset Password</h1>
          <p className="text-gray-400">
            Enter your email and we'll send you a link to reset your password
          </p>
        </div>

        {success ? (
          // Success State
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
            <div className="flex justify-center mb-4">
              <div className="bg-green-500/20 rounded-full p-3">
                <CheckCircle className="h-12 w-12 text-green-400" />
              </div>
            </div>

            <h2 className="text-xl font-bold text-white mb-2">Check Your Email</h2>
            <p className="text-gray-400 mb-6">
              We've sent a password reset link to <strong className="text-white">{email}</strong>
            </p>

            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
              <p className="text-sm text-yellow-400">
                ⚠️ The link will expire in 1 hour. Make sure to check your spam folder.
              </p>
            </div>

            <Button
              onClick={onNavigateToLogin}
              className="w-full bg-[#CCFF00] text-black font-bold hover:bg-[#B8E600]"
            >
              Back to Sign In
            </Button>
          </div>
        ) : (
          // Form State
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Error Message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500 text-red-500 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            {/* Email */}
            <div>
              <Label htmlFor="email" className="text-gray-300">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-gray-900 border-gray-700 text-white focus:border-[#CCFF00] pl-10"
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#CCFF00] text-black font-bold hover:bg-[#B8E600] disabled:opacity-50"
            >
              {isLoading ? 'Sending...' : 'Send Reset Link'}
            </Button>

            {/* Back to Sign In */}
            <button
              type="button"
              onClick={onNavigateToLogin}
              className="w-full flex items-center justify-center gap-2 text-gray-400 hover:text-white text-sm py-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Sign In
            </button>
          </form>
        )}

        {/* Footer Tagline */}
        <div className="mt-8 text-center text-xs text-gray-600">
          Pan-African Digital Banking Platform
        </div>
      </div>
    </div>
  );
}