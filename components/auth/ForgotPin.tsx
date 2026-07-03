import React, { useMemo, useState } from 'react';
import { ArrowLeft, Mail, CheckCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { backendAPI } from '../../utils/api/backendAPI';
import { authAPI } from '../../utils/supabase/client';

interface Props {
  onNavigateToLogin: () => void;
}

export function ForgotPin({ onNavigateToLogin }: Props) {
  const defaultEmail = useMemo(() => {
    try { return String(authAPI.getStoredUser()?.email || ''); } catch { return ''; }
  }, []);
  const [email, setEmail] = useState(defaultEmail);
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
      await backendAPI.auth.requestPinReset(email);
      setSuccess(true);
    } catch {
      setError('Something went wrong. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] max-h-[100dvh] bg-[#0B0E11] text-white flex items-center justify-center px-safe py-safe overflow-hidden fixed inset-0">
      <div className="glass-gradient-bg" />
      <div className="glass-noise-overlay" />
      <div className="w-full max-w-md overflow-y-auto overflow-x-hidden max-h-[100dvh] px-4 py-6 hide-scrollbar relative z-[2]">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Forgot PIN</h1>
          <p className="text-gray-400">
            Enter your email and we&apos;ll send a secure PIN reset link
          </p>
        </div>

        {success ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
            <div className="flex justify-center mb-4">
              <div className="bg-green-500/20 rounded-full p-3">
                <CheckCircle className="h-12 w-12 text-green-400" />
              </div>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Check Your Email</h2>
            <p className="text-gray-400 mb-6">
              If an account exists for <strong className="text-white">{email}</strong>, a PIN reset link has been sent.
            </p>
            <Button
              onClick={onNavigateToLogin}
              className="w-full bg-[#CCFF00] text-black font-bold hover:bg-[#B8E600]"
            >
              Back to Sign In
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500 text-red-500 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}
            <div>
              <Label htmlFor="email" className="text-gray-300">Email Address</Label>
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
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#CCFF00] text-black font-bold hover:bg-[#B8E600] disabled:opacity-50"
            >
              {isLoading ? 'Sending...' : 'Send PIN Reset Link'}
            </Button>
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
      </div>
    </div>
  );
}

