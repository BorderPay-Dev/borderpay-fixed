/**
 * BorderPay Africa — KYC Verification Screen
 *
 * Uses SmileID Smile Link (hosted no-code) for document verification:
 *   1. Welcome — overview of benefits + requirements
 *   2. Redirect — opens SmileID hosted page for capture & verification
 *   3. Processing — polls backend for SmileID callback result
 *   4. Result — success or failure
 *
 * Backend: smile-callback-handler receives SmileID callbacks and updates
 * the user's KYC status in the database.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BASE_URL, ANON_KEY, storeUserProfile, readUserProfile, dataCache } from '../../utils/supabase/client';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck, ArrowLeft, Camera, FileText, AlertCircle,
  CheckCircle, Loader2, RefreshCw, Fingerprint,
  Lock, Eye, ChevronRight, Wifi, CreditCard, Globe,
  Smartphone, UserCheck, Scan, Shield, Star,
  ArrowRight, Zap, BadgeCheck, ExternalLink
} from 'lucide-react';
import { toast } from 'sonner';
import { authAPI } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KYCVerificationProps {
  userId: string;
  userEmail: string;
  onBack: () => void;
  onComplete: () => void;
}

type KYCStep = 'welcome' | 'loading' | 'redirect' | 'processing' | 'success' | 'failed';

// ─── Constants ───────────────────────────────────────────────────────────────

/** SmileID Smile Link URL — set in SmileID portal with callback pointing to
 *  our smile-callback-handler edge function. If the backend returns a
 *  smile_link URL, that takes precedence. */
const SMILE_LINK_BASE = import.meta.env.VITE_SMILEID_LINK_URL
  || 'https://links.sandbox.usesmileid.com/8077/4ad0eb49-0a5d-45e1-8365-b64c5bc3fe98';

const UNLOCK_FEATURES = [
  { icon: Globe,      label: 'USD Account',      color: 'from-blue-500/10 to-blue-600/5' },
  { icon: CreditCard, label: 'Virtual Cards',     color: 'from-purple-500/10 to-purple-600/5' },
  { icon: Wifi,       label: 'SWIFT Transfers',   color: 'from-green-500/10 to-green-600/5' },
  { icon: Star,       label: 'Higher Limits',     color: 'from-amber-500/10 to-amber-600/5' },
];

const STEPS_CONFIG = [
  { label: 'Welcome', icon: Shield },
  { label: 'Verify', icon: Scan },
  { label: 'Review', icon: Eye },
  { label: 'Done', icon: BadgeCheck },
];

// ─── Main Component ──────────────────────────────────────────────────────────

export function KYCVerification({ userId, userEmail, onBack, onComplete }: KYCVerificationProps) {
  const [step, setStep] = useState<KYCStep>('welcome');
  const [error, setError] = useState<string | null>(null);
  const [smileLinkUrl, setSmileLinkUrl] = useState<string>('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    pollCountRef.current = 0;
  }, []);

  const checkVerificationStatus = useCallback(async () => {
    // Stop after 60 polls (10 minutes at 10s intervals)
    pollCountRef.current += 1;
    if (pollCountRef.current > 60) {
      stopPolling();
      setStep(current => {
        if (current === 'processing') {
          toast.info("Verification is being processed. You'll be notified when complete.");
          setTimeout(() => onComplete(), 1500);
        }
        return current;
      });
      return;
    }

    try {
      const token = authAPI.getToken();
      if (!token) return;
      const response = await fetch(
        `${BASE_URL}/smile-callback-handler?userId=${userId}`,
        { headers: { 'Authorization': `Bearer ${token}`, 'apikey': ANON_KEY } }
      );
      const data = await response.json();
      if (data.success) {
        if (data.status === 'verified') handleVerificationDone('success');
        else if (data.status === 'failed') handleVerificationDone('failed');
      }
    } catch (e) { /* polling will retry */ }
  }, [userId]);

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollCountRef.current = 0;
    pollingRef.current = setInterval(() => checkVerificationStatus(), 10000);
  }, [checkVerificationStatus]);

  const handleVerificationDone = async (result: 'success' | 'failed') => {
    stopPolling();
    if (result === 'success') {
      setStep('success');
      toast.success('Identity verified!');
      try {
        const profileResult = await backendAPI.user.getProfile();
        if (profileResult.success && profileResult.data?.user) {
          storeUserProfile(profileResult.data.user);
          dataCache.invalidate('profile');
        }
      } catch (e) { /* silent */ }
      setTimeout(() => onComplete(), 3500);
    } else {
      setStep('failed');
      setError('Verification could not be completed. Please try again.');
      toast.error('Verification failed');
    }
  };

  // ─── Initialize: get Smile Link URL from backend ──────────────────────────

  const initializeVerification = async () => {
    setStep('loading');
    setError(null);

    let linkUrl = '';

    // Try backend first — it may return a dynamic Smile Link URL
    try {
      const token = authAPI.getToken();
      const response = await fetch(`${BASE_URL}/smile-callback-handler`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({
          product: 'doc_verification',
          country: readUserProfile()?.country || 'NG',
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.data?.already_verified) {
          handleVerificationDone('success');
          return;
        }
        linkUrl = result.data?.smile_link || result.data?.consent_url || '';
      }
    } catch {
      // Backend unavailable — fall through to default Smile Link
    }

    // Fall back to configured Smile Link URL
    if (!linkUrl) linkUrl = SMILE_LINK_BASE;

    if (!linkUrl) {
      setStep('failed');
      setError('Verification link not configured. Please contact support.');
      toast.error('Could not start verification');
      return;
    }

    // Validate URL origin
    try {
      const host = new URL(linkUrl).hostname;
      const TRUSTED = ['smileidentity.com', 'usesmileid.com', 'sandbox.usesmileid.com', 'supabase.co'];
      if (!TRUSTED.some(t => host.endsWith(t))) {
        throw new Error('Untrusted verification URL');
      }
    } catch (urlErr: any) {
      setStep('failed');
      setError(urlErr.message === 'Untrusted verification URL' ? urlErr.message : 'Invalid verification URL');
      toast.error('Could not start verification');
      return;
    }

    setSmileLinkUrl(linkUrl);
    setStep('redirect');

    // Start polling for the callback result
    setTimeout(() => checkVerificationStatus(), 15000);
    startPolling();
  };

  const openSmileLink = () => {
    if (smileLinkUrl) {
      window.open(smileLinkUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleRetry = () => {
    stopPolling();
    setStep('welcome');
    setError(null);
    setSmileLinkUrl('');
  };

  // ── Step progress ──
  const activeStepIdx =
    step === 'welcome' ? 0 :
    step === 'loading' || step === 'redirect' ? 1 :
    step === 'processing' ? 2 :
    step === 'success' ? 3 : 2;

  const progressPct: Record<KYCStep, number> = {
    welcome: 0, loading: 20,
    redirect: 50, processing: 75, success: 100, failed: 60,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-full bg-[#0B0E11] text-white flex flex-col pb-safe">
      {/* ── Header ── */}
      <div className="sticky top-0 z-30 bg-[#0B0E11]/95 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="flex items-center justify-between px-4 py-3 pt-safe">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center hover:bg-white/10 transition-all active:scale-90"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="flex items-center gap-2">
            <Shield size={14} className="text-[#C7FF00]" />
            <span className="text-[11px] font-bold tracking-widest uppercase">
              Identity Verification
            </span>
          </div>

          <div className="w-9 flex items-center justify-center">
            {(step === 'redirect' || step === 'processing') && (
              <div className="w-2 h-2 rounded-full bg-[#C7FF00] animate-pulse" />
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-[2px] bg-white/[0.04]">
          <motion.div
            className="h-full bg-gradient-to-r from-[#C7FF00] to-[#9BDB00]"
            animate={{ width: `${progressPct[step]}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* ── Step indicators ── */}
      {step !== 'success' && step !== 'failed' && (
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center justify-between">
            {STEPS_CONFIG.map((s, i) => (
              <React.Fragment key={i}>
                <div className="flex flex-col items-center gap-1.5">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                    i < activeStepIdx
                      ? 'bg-[#C7FF00] text-[#0B0E11]'
                      : i === activeStepIdx
                        ? 'bg-[#C7FF00]/20 border border-[#C7FF00]/50 text-[#C7FF00]'
                        : 'bg-white/[0.04] border border-white/[0.08] text-gray-600'
                  }`}>
                    {i < activeStepIdx ? <CheckCircle size={14} /> : <s.icon size={13} />}
                  </div>
                  <span className={`text-[8px] font-bold uppercase tracking-wider ${
                    i <= activeStepIdx ? 'text-[#C7FF00]' : 'text-gray-700'
                  }`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS_CONFIG.length - 1 && (
                  <div className={`flex-1 h-[1px] mx-2 mb-5 transition-colors duration-300 ${
                    i < activeStepIdx ? 'bg-[#C7FF00]/40' : 'bg-white/[0.06]'
                  }`} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col">
        <AnimatePresence mode="wait">

          {/* ═══ WELCOME ═══ */}
          {step === 'welcome' && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="flex-1 px-5 py-4"
            >
              <div className="flex flex-col items-center mb-6">
                <div className="relative">
                  <motion.div
                    className="absolute -inset-4 rounded-full"
                    style={{ background: 'radial-gradient(circle, rgba(199,255,0,0.12) 0%, transparent 70%)' }}
                    animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                  />
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#C7FF00]/20 to-[#C7FF00]/5 border border-[#C7FF00]/20 flex items-center justify-center relative z-10 rotate-3">
                    <Fingerprint className="w-10 h-10 text-[#C7FF00]" strokeWidth={1.5} />
                  </div>
                </div>
                <h1 className="text-xl font-black mt-5 tracking-tight">Verify Your Identity</h1>
                <p className="text-xs text-gray-500 text-center mt-1.5 max-w-[280px] leading-relaxed">
                  Complete KYC verification to unlock all BorderPay features. Quick, secure, powered by SmileID.
                </p>
              </div>

              <div className="mb-5">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-3.5 h-3.5 text-[#C7FF00]" />
                  <span className="text-[10px] font-bold text-[#C7FF00] uppercase tracking-widest">Unlock Features</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {UNLOCK_FEATURES.map((f, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + i * 0.07 }}
                      className={`flex items-center gap-2.5 bg-gradient-to-br ${f.color} border border-white/[0.06] rounded-xl px-3 py-2.5`}
                    >
                      <f.icon className="w-4 h-4 text-white/60" />
                      <span className="text-[10px] font-semibold text-white/80">{f.label}</span>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* How it works */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-3">
                  <Eye className="w-3.5 h-3.5 text-[#C7FF00]" />
                  <span className="text-[10px] font-bold text-[#C7FF00] uppercase tracking-widest">How It Works</span>
                </div>
                <div className="space-y-2">
                  {[
                    { num: '1', text: 'Tap "Start Verification" — opens SmileID secure page' },
                    { num: '2', text: 'Select your document type (Passport, ID, etc.)' },
                    { num: '3', text: 'Take a selfie & photo of your ID' },
                    { num: '4', text: 'Come back — we\'ll notify you when verified' },
                  ].map((s, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.08 }}
                      className="flex items-center gap-3 bg-white/[0.02] border border-white/[0.04] rounded-xl px-3.5 py-2.5"
                    >
                      <div className="w-6 h-6 rounded-full bg-[#C7FF00]/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-[#C7FF00]">{s.num}</span>
                      </div>
                      <p className="text-[10px] text-gray-400">{s.text}</p>
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-2.5 bg-white/[0.02] border border-white/[0.06] rounded-xl px-3.5 py-3">
                <Lock className="w-3.5 h-3.5 text-[#C7FF00]/60 flex-shrink-0 mt-0.5" />
                <p className="text-[9px] text-[#C7FF00]/50 leading-relaxed">
                  End-to-end encrypted. Biometric data is processed by SmileID and never stored on BorderPay servers.
                </p>
              </div>
            </motion.div>
          )}

          {/* WELCOME CTA */}
          {step === 'welcome' && (
            <div className="px-5 pt-2 pb-6 pb-safe">
              <motion.button
                onClick={initializeVerification}
                className="w-full relative overflow-hidden bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-extrabold text-sm tracking-wide flex items-center justify-center gap-2.5"
                whileTap={{ scale: 0.97 }}
              >
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut', repeatDelay: 1.5 }}
                  style={{ width: '40%' }}
                />
                <ShieldCheck size={18} className="relative z-10" />
                <span className="relative z-10">Start Verification</span>
                <ArrowRight size={16} className="relative z-10" />
              </motion.button>
              <button onClick={onBack} className="w-full text-gray-600 py-3 text-[10px] font-medium hover:text-gray-400 transition-colors">
                I'll verify later
              </button>
            </div>
          )}

          {/* ═══ LOADING ═══ */}
          {step === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center px-6"
            >
              <div className="relative w-28 h-28 mb-6">
                <motion.div
                  className="absolute inset-0 rounded-2xl border-2 border-[#C7FF00]/20"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
                />
                <motion.div
                  className="absolute inset-3 rounded-xl border border-[#C7FF00]/15"
                  animate={{ rotate: -360 }}
                  transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Scan className="w-10 h-10 text-[#C7FF00]" strokeWidth={1.5} />
                </div>
              </div>
              <h3 className="text-sm font-bold mb-1.5">Preparing Verification</h3>
              <p className="text-[10px] text-gray-600 mb-5">Connecting to SmileID...</p>
            </motion.div>
          )}

          {/* ═══ REDIRECT — user opens SmileID hosted page ═══ */}
          {step === 'redirect' && (
            <motion.div
              key="redirect"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="flex-1 px-5 py-6 flex flex-col items-center"
            >
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-600/5 border border-blue-500/20 flex items-center justify-center mb-5">
                <ExternalLink className="w-10 h-10 text-blue-400" strokeWidth={1.5} />
              </div>

              <h2 className="text-lg font-bold text-white mb-2 text-center">Complete on SmileID</h2>
              <p className="text-xs text-gray-400 text-center max-w-[280px] mb-6 leading-relaxed">
                A secure SmileID page has opened. Complete your verification there, then come back here.
              </p>

              {/* Open link button */}
              <motion.button
                onClick={openSmileLink}
                className="w-full max-w-[300px] bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2.5 mb-4"
                whileTap={{ scale: 0.97 }}
              >
                <ExternalLink size={16} />
                Open SmileID Verification
              </motion.button>

              {/* Instructions */}
              <div className="w-full max-w-[300px] bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 mb-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-[#C7FF00]/10 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 text-[#C7FF00] animate-spin" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-white">Waiting for Verification</p>
                    <p className="text-[9px] text-gray-500">We'll detect when you're done</p>
                  </div>
                </div>
                <div className="space-y-2 text-[10px] text-gray-400 leading-relaxed">
                  <p>1. Select your document type on the SmileID page</p>
                  <p>2. Take a selfie and photo of your ID</p>
                  <p>3. Come back to this screen when finished</p>
                </div>
              </div>

              {/* Already done button */}
              <button
                onClick={() => {
                  setStep('processing');
                  toast.info('Checking verification status...');
                  checkVerificationStatus();
                }}
                className="text-[#C7FF00]/70 text-xs font-semibold hover:text-[#C7FF00] transition-colors"
              >
                I've completed verification
              </button>
            </motion.div>
          )}

          {/* ═══ PROCESSING / SUBMITTED ═══ */}
          {step === 'processing' && (
            <motion.div
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center px-6"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[#C7FF00]/20 to-[#C7FF00]/5 border border-[#C7FF00]/20 flex items-center justify-center mb-5"
              >
                <FileText className="w-12 h-12 text-[#C7FF00]" strokeWidth={1.5} />
              </motion.div>

              <h2 className="text-lg font-bold text-white mb-2 text-center">Verification In Progress</h2>
              <p className="text-xs text-gray-400 text-center max-w-[280px] mb-5 leading-relaxed">
                Your identity document has been submitted for review.
              </p>

              <div className="w-full max-w-[300px] bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 mb-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-[#C7FF00]/10 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 text-[#C7FF00] animate-spin" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-white">Under Review</p>
                    <p className="text-[9px] text-gray-500">Usually takes a few minutes</p>
                  </div>
                </div>
                <div className="space-y-2 text-[10px] text-gray-400 leading-relaxed">
                  <p>Our verification team is reviewing your document to ensure it meets all security requirements.</p>
                  <p>You will receive an <span className="text-[#C7FF00]/80 font-medium">email notification</span> and an <span className="text-[#C7FF00]/80 font-medium">in-app notification</span> once your verification is complete.</p>
                </div>
              </div>

              <div className="w-full max-w-[300px] space-y-2">
                <div className="flex items-center gap-2.5 bg-blue-500/[0.06] border border-blue-500/[0.1] rounded-xl px-3.5 py-2.5">
                  <CheckCircle className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                  <p className="text-[9px] text-blue-300/80">You can continue using BorderPay while we review your document.</p>
                </div>
              </div>

              <motion.button
                onClick={onComplete}
                className="mt-6 w-full max-w-[300px] bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2"
                whileTap={{ scale: 0.97 }}
              >
                <ArrowRight size={16} />
                Back to Dashboard
              </motion.button>
            </motion.div>
          )}

          {/* ═══ SUCCESS ═══ */}
          {step === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center px-6"
            >
              <div className="relative">
                {[...Array(12)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: i % 3 === 0 ? '#C7FF00' : i % 3 === 1 ? '#FFFFFF' : '#9BDB00',
                      top: '50%', left: '50%',
                    }}
                    initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                    animate={{
                      x: Math.cos((i * Math.PI * 2) / 12) * 80,
                      y: Math.sin((i * Math.PI * 2) / 12) * 80,
                      opacity: 0, scale: 0,
                    }}
                    transition={{ duration: 0.9, delay: 0.2 + i * 0.04, ease: 'easeOut' }}
                  />
                ))}
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ duration: 0.5, ease: 'easeOut', delay: 0.1 }}
                  className="w-28 h-28 rounded-3xl bg-gradient-to-br from-[#C7FF00]/25 to-[#C7FF00]/5 border-2 border-[#C7FF00]/30 flex items-center justify-center relative z-10"
                >
                  <BadgeCheck className="w-14 h-14 text-[#C7FF00]" strokeWidth={1.5} />
                </motion.div>
              </div>
              <div className="text-center mt-6">
                <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                  className="text-2xl font-black text-white mb-2">Verified!</motion.h2>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
                  className="text-xs text-gray-400 max-w-[260px] mb-6">
                  Your identity has been confirmed. All premium features are now unlocked.
                </motion.p>
                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.9 }}
                  className="inline-flex items-center gap-2.5 px-5 py-3 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-2xl">
                  <ShieldCheck className="w-4 h-4 text-[#C7FF00]" />
                  <span className="text-xs text-[#C7FF00] font-bold">KYC Level 2 — Fully Verified</span>
                </motion.div>
              </div>
            </motion.div>
          )}

          {/* ═══ FAILED ═══ */}
          {step === 'failed' && (
            <motion.div
              key="failed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center px-6"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="w-24 h-24 rounded-3xl bg-red-500/10 border border-red-500/15 flex items-center justify-center mb-5"
              >
                <AlertCircle className="w-12 h-12 text-red-400" />
              </motion.div>
              <h2 className="text-lg font-bold text-white mb-1.5">Verification Failed</h2>
              <p className="text-[11px] text-gray-400 text-center max-w-[260px] mb-1.5">
                {error || 'We could not verify your identity.'}
              </p>
              <p className="text-[9px] text-gray-600 text-center max-w-[240px] mb-6">
                Make sure your ID is fully visible, well-lit, and your selfie is clear. Then try again.
              </p>
              <div className="w-full max-w-[280px] space-y-2.5">
                <motion.button
                  onClick={handleRetry}
                  className="w-full bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
                  whileTap={{ scale: 0.97 }}
                >
                  <RefreshCw size={15} />
                  Try Again
                </motion.button>
                <button onClick={onBack} className="w-full text-gray-500 py-3 text-[10px] font-medium hover:text-gray-300 transition-colors">
                  Go Back
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
