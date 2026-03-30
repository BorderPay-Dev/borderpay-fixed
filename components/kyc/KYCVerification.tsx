/**
 * BorderPay Africa — KYC Verification Screen
 *
 * Embeds SmileID Smile Link in an iframe inside the app.
 * After user completes verification, shows "Under Review" with 2 business day timeline.
 * No external tabs — user never leaves the app.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BASE_URL, ANON_KEY, storeUserProfile, readUserProfile, dataCache } from '../../utils/supabase/client';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck, ArrowLeft, FileText, AlertCircle,
  CheckCircle, Loader2, RefreshCw, Fingerprint,
  Lock, Eye, ChevronRight, Wifi, CreditCard, Globe,
  UserCheck, Scan, Shield, Star,
  ArrowRight, Zap, BadgeCheck, Clock
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

type KYCStep = 'welcome' | 'loading' | 'verifying' | 'under-review' | 'success' | 'failed';

// ─── Constants ───────────────────────────────────────────────────────────────

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
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Check if user already has pending/verified KYC on mount
  useEffect(() => {
    checkExistingStatus();
    return () => stopPolling();
  }, []);

  // Listen for SmileID redirect via postMessage or URL detection
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // SmileID may send postMessage when done
      if (event.data?.type === 'SmileIdentity::Close' ||
          event.data?.type === 'SmileIdentity::Complete' ||
          event.data?.status === 'complete') {
        handleSmileIDComplete();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Detect iframe navigating to our redirect URL (same-origin)
  useEffect(() => {
    if (step !== 'verifying') return;
    const checkIframeUrl = setInterval(() => {
      try {
        const iframeUrl = iframeRef.current?.contentWindow?.location?.href;
        if (iframeUrl && iframeUrl.includes('verification-complete')) {
          clearInterval(checkIframeUrl);
          handleSmileIDComplete();
        }
      } catch {
        // Cross-origin — expected while on SmileID domain
      }
    }, 1000);
    return () => clearInterval(checkIframeUrl);
  }, [step]);

  const checkExistingStatus = async () => {
    try {
      const token = authAPI.getToken();
      if (!token) return;
      const response = await fetch(`${BASE_URL}/query-kyc-status`, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': ANON_KEY },
      });
      const data = await response.json();
      if (data.success) {
        if (data.status === 'verified') {
          setStep('success');
        } else if (data.status === 'pending') {
          setStep('under-review');
          startPolling();
        }
      }
    } catch { /* continue to welcome */ }
  };

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    pollCountRef.current = 0;
  }, []);

  const checkVerificationStatus = useCallback(async (manual = false) => {
    pollCountRef.current += 1;
    if (!manual && pollCountRef.current > 120) {
      stopPolling();
      return;
    }
    try {
      const token = authAPI.getToken();
      if (!token) return;
      const response = await fetch(`${BASE_URL}/query-kyc-status`, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': ANON_KEY },
      });
      const data = await response.json();
      if (data.success) {
        if (data.status === 'verified') {
          stopPolling();
          setStep('success');
          toast.success('Identity verified!');
          try {
            const profileResult = await backendAPI.user.getProfile();
            if (profileResult.success && profileResult.data?.user) {
              storeUserProfile(profileResult.data.user);
              dataCache.invalidate('profile');
            }
          } catch { /* silent */ }
        } else if (data.status === 'failed') {
          stopPolling();
          setStep('failed');
          setError('Verification could not be completed. Please try again.');
          toast.error('Verification failed');
        }
      }
    } catch { /* polling will retry */ }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollCountRef.current = 0;
    pollingRef.current = setInterval(() => checkVerificationStatus(false), 30000);
  }, [checkVerificationStatus]);

  const handleSmileIDComplete = () => {
    setStep('under-review');
    startPolling();
    toast.success('Verification submitted! Under review.');
  };

  // ─── Initialize: build Smile Link URL with user_id + job_id ──────────────

  const initializeVerification = async () => {
    setStep('loading');
    setError(null);
    setIframeLoaded(false);

    // Generate a unique job_id for this verification session
    const jobId = crypto.randomUUID();

    // Build Smile Link URL with user_id and job_id so SmileID tracks under our user
    const params = new URLSearchParams({ user_id: userId, job_id: jobId });
    const linkUrl = `${SMILE_LINK_BASE}?${params.toString()}`;

    // Store pending job record in DB (non-blocking)
    try {
      const token = authAPI.getToken();
      await fetch(`${BASE_URL}/query-kyc-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({ job_id: jobId }),
      });
    } catch { /* non-blocking */ }

    setSmileLinkUrl(linkUrl);
    setStep('verifying');
    startPolling();
  };

  const handleRetry = () => {
    stopPolling();
    setStep('welcome');
    setError(null);
    setSmileLinkUrl('');
    setIframeLoaded(false);
  };

  // Get business day deadline (2 business days from now)
  const getDeadline = () => {
    const now = new Date();
    let days = 0;
    const deadline = new Date(now);
    while (days < 2) {
      deadline.setDate(deadline.getDate() + 1);
      const dow = deadline.getDay();
      if (dow !== 0 && dow !== 6) days++;
    }
    return deadline.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  // ── Step progress ──
  const activeStepIdx =
    step === 'welcome' ? 0 :
    step === 'loading' || step === 'verifying' ? 1 :
    step === 'under-review' ? 2 :
    step === 'success' ? 3 : 2;

  const progressPct: Record<KYCStep, number> = {
    welcome: 0, loading: 20,
    verifying: 50, 'under-review': 75, success: 100, failed: 60,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-full bg-[#0B0E11] text-white flex flex-col pb-safe">
      {/* ── Header ── */}
      {step !== 'verifying' && (
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
              {(step === 'under-review') && (
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
      )}

      {/* ── Step indicators ── */}
      {step !== 'success' && step !== 'failed' && step !== 'verifying' && (
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
                    { num: '1', text: 'Tap "Start Verification" below' },
                    { num: '2', text: 'Select your document type (Passport, ID, etc.)' },
                    { num: '3', text: 'Take a selfie & photo of your ID' },
                    { num: '4', text: 'Your verification will be reviewed within 2 business days' },
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
                <div className="absolute inset-0 flex items-center justify-center">
                  <Scan className="w-10 h-10 text-[#C7FF00]" strokeWidth={1.5} />
                </div>
              </div>
              <h3 className="text-sm font-bold mb-1.5">Preparing Verification</h3>
              <p className="text-[10px] text-gray-600 mb-5">Connecting to SmileID...</p>
            </motion.div>
          )}

          {/* ═══ VERIFYING — SmileID embedded in iframe ═══ */}
          {step === 'verifying' && (
            <motion.div
              key="verifying"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col"
            >
              {/* Minimal header bar for iframe mode */}
              <div className="flex items-center justify-between px-4 py-2 bg-[#0B0E11] border-b border-white/[0.06] pt-safe">
                <button
                  onClick={() => {
                    handleSmileIDComplete();
                  }}
                  className="flex items-center gap-2 text-[#C7FF00] text-xs font-semibold"
                >
                  <ArrowLeft size={14} />
                  Done
                </button>
                <div className="flex items-center gap-1.5">
                  <Shield size={12} className="text-[#C7FF00]" />
                  <span className="text-[10px] text-gray-400 font-medium">SmileID Secure</span>
                </div>
                <div className="w-12" />
              </div>

              {/* Loading overlay while iframe loads */}
              {!iframeLoaded && (
                <div className="flex-1 flex flex-col items-center justify-center">
                  <Loader2 className="w-8 h-8 text-[#C7FF00] animate-spin mb-3" />
                  <p className="text-xs text-gray-500">Loading SmileID...</p>
                </div>
              )}

              {/* SmileID iframe */}
              <iframe
                ref={iframeRef}
                src={smileLinkUrl}
                className={`flex-1 w-full border-0 ${iframeLoaded ? 'block' : 'hidden'}`}
                style={{ minHeight: 'calc(100vh - 60px)' }}
                allow="camera; microphone"
                onLoad={() => setIframeLoaded(true)}
                title="SmileID Verification"
              />
            </motion.div>
          )}

          {/* ═══ UNDER REVIEW ═══ */}
          {step === 'under-review' && (
            <motion.div
              key="under-review"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="flex-1 flex flex-col items-center px-5 py-8"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="w-24 h-24 rounded-3xl bg-gradient-to-br from-yellow-500/20 to-orange-500/10 border border-yellow-500/20 flex items-center justify-center mb-5"
              >
                <Clock className="w-12 h-12 text-yellow-400" strokeWidth={1.5} />
              </motion.div>

              <h2 className="text-xl font-black text-white mb-2 text-center">Under Review</h2>
              <p className="text-xs text-gray-400 text-center max-w-[300px] mb-6 leading-relaxed">
                Your identity verification has been submitted successfully. Our team is reviewing your documents.
              </p>

              {/* Deadline card */}
              <div className="w-full max-w-[320px] bg-gradient-to-br from-yellow-500/[0.08] to-orange-500/[0.04] border border-yellow-500/20 rounded-2xl p-5 mb-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-yellow-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">Estimated Completion</p>
                    <p className="text-xs text-yellow-400 font-semibold">Within 2 business days</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-black/20 rounded-xl px-4 py-3">
                  <CheckCircle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                  <p className="text-[11px] text-gray-300">
                    Expected by <span className="text-yellow-400 font-bold">{getDeadline()}</span>
                  </p>
                </div>
              </div>

              {/* What happens next */}
              <div className="w-full max-w-[320px] bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 mb-5">
                <p className="text-[10px] font-bold text-[#C7FF00] uppercase tracking-widest mb-3">What happens next</p>
                <div className="space-y-3">
                  {[
                    { icon: Eye, text: 'Our team reviews your ID and selfie' },
                    { icon: ShieldCheck, text: 'SmileID verifies document authenticity' },
                    { icon: FileText, text: 'You receive an email + in-app notification' },
                    { icon: BadgeCheck, text: 'All premium features unlock automatically' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                        <item.icon size={13} className="text-gray-400" />
                      </div>
                      <p className="text-[10px] text-gray-400 leading-relaxed">{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Info banner */}
              <div className="w-full max-w-[320px] flex items-start gap-2.5 bg-blue-500/[0.06] border border-blue-500/[0.1] rounded-xl px-3.5 py-3 mb-6">
                <CheckCircle className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-[9px] text-blue-300/80 leading-relaxed">
                  You can continue using BorderPay while we review your documents. Basic features remain available.
                </p>
              </div>

              <motion.button
                onClick={async () => {
                  setIsChecking(true);
                  await checkVerificationStatus(true);
                  setIsChecking(false);
                }}
                disabled={isChecking}
                className="w-full max-w-[320px] bg-white/[0.06] border border-white/[0.12] text-white py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 mb-3 disabled:opacity-50"
                whileTap={{ scale: 0.97 }}
              >
                {isChecking
                  ? <><Loader2 size={16} className="animate-spin" /> Checking...</>
                  : <><RefreshCw size={16} /> Check Status</>
                }
              </motion.button>

              <motion.button
                onClick={onBack}
                className="w-full max-w-[320px] bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2"
                whileTap={{ scale: 0.97 }}
              >
                <ArrowRight size={16} />
                Back to App
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
                  className="inline-flex items-center gap-2.5 px-5 py-3 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-2xl mb-6">
                  <ShieldCheck className="w-4 h-4 text-[#C7FF00]" />
                  <span className="text-xs text-[#C7FF00] font-bold">KYC Level 2 — Fully Verified</span>
                </motion.div>
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.1 }}
                  onClick={onComplete}
                  className="w-full max-w-[280px] bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 mx-auto"
                  whileTap={{ scale: 0.97 }}
                >
                  <ArrowRight size={16} />
                  Continue
                </motion.button>
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
