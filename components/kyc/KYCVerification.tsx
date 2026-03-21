import { BorderPayLogo } from '../cards/BorderPayLogo';
/**
 * BorderPay Africa - KYC Verification Screen
 * Embeds SmileID widget directly in-app via themed iframe
 * Full BorderPay neon green/black branding applied to SmileID widget
 * Users complete verification without leaving the app
 *
 * Status polling uses smile-callback-handler (deployed edge function)
 */

import React, { useState, useEffect, useRef } from 'react';
import { SERVER_URL, ANON_KEY } from '../../utils/supabase/client';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck, ArrowLeft, Camera, FileText, AlertCircle,
  CheckCircle, Loader2, X, RefreshCw, Fingerprint,
  Lock, Eye, Sparkles, ChevronRight, Wifi
} from 'lucide-react';
import { toast } from 'sonner';
import { authAPI, supabase } from '../../utils/supabase/client';
import { projectId } from '../../utils/supabase/info';

import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { backendAPI } from '../../utils/api/backendAPI';

interface KYCVerificationProps {
  userId: string;
  userEmail: string;
  onBack: () => void;
  onComplete: () => void;
}

type VerificationStep = 'intro' | 'permissions' | 'loading' | 'widget' | 'processing' | 'success' | 'failed';

// SmileID sandbox widget URL (fallback)
const SMILEID_SANDBOX_URL = 'https://links.sandbox.usesmileid.com/8077/4ad0eb49-0a5d-45e1-8365-b64c5bc3fe98';

// BorderPay theme config for SmileID
const BORDERPAY_SMILEID_THEME = {
  partner_name: 'BorderPay Africa',
  theme_color: '#C7FF00',
  logo_url: '',
  accent_color: '#C7FF00',
  background_color: '#0B0E11',
  text_color: '#FFFFFF',
  button_color: '#C7FF00',
  button_text_color: '#0B0E11',
};

// Append SmileID theming query params to widget URL
function appendSmileIDThemeParams(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('theme_color', BORDERPAY_SMILEID_THEME.theme_color.replace('#', ''));
    u.searchParams.set('partner_name', BORDERPAY_SMILEID_THEME.partner_name);
    u.searchParams.set('hide_attribution', 'false');
    return u.toString();
  } catch {
    return url;
  }
}

export function KYCVerification({ userId, userEmail, onBack, onComplete }: KYCVerificationProps) {
  const [step, setStep] = useState<VerificationStep>('intro');
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [cameraGranted, setCameraGranted] = useState<boolean | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Cleanup
  useEffect(() => {
    return () => {
      stopPolling();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Listen for postMessage from SmileID widget
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      console.log('📨 postMessage:', event.origin, event.data);
      if (!event.data) return;

      const data = typeof event.data === 'string' ? tryParseJSON(event.data) : event.data;
      if (!data) return;

      if (data.event === 'smileid:complete' || data.status === 'complete' ||
          data.ResultCode === '1012' || data.SmileJobID) {
        handleVerificationDone('success');
      }
      if (data.event === 'smileid:error') {
        handleVerificationDone('failed');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const tryParseJSON = (str: string) => {
    try { return JSON.parse(str); } catch { return null; }
  };

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const startPolling = () => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      await checkVerificationStatus();
    }, 3000);
  };

  const startTimer = () => {
    setElapsedSeconds(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
  };

  // Poll smile-callback-handler for verification status
  const checkVerificationStatus = async () => {
    try {
      const token = authAPI.getToken();
      if (!token) return;

      const response = await fetch(
        `${SERVER_URL}/smile-callback-handler?userId=${userId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': ANON_KEY,
          }
        }
      );
      const data = await response.json();
      console.log('📊 KYC Poll:', data.status);

      if (data.success) {
        if (data.status === 'verified') handleVerificationDone('success');
        else if (data.status === 'failed') handleVerificationDone('failed');
      }
    } catch (e) {
      console.warn('⚠️ Poll error:', e);
    }
  };

  const handleVerificationDone = async (result: 'success' | 'failed') => {
    stopPolling();
    if (timerRef.current) clearInterval(timerRef.current);

    if (result === 'success') {
      setStep('success');
      toast.success('Identity verified successfully!');

      // Refresh user profile
      try {
        const profileResult = await backendAPI.user.getProfile();
        if (profileResult.success && profileResult.data?.user) {
          localStorage.setItem('borderpay_user', JSON.stringify(profileResult.data.user));
        }
      } catch (e) {
        console.warn('⚠️ Profile refresh error:', e);
      }
      setTimeout(() => onComplete(), 3000);
    } else {
      setStep('failed');
      setError('Verification could not be completed. Please try again.');
      toast.error('Verification failed.');
    }
  };

  // Check camera permission
  const checkCameraPermission = async () => {
    setStep('permissions');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());
      setCameraGranted(true);
      // Auto-proceed after a short delay
      setTimeout(() => launchWidget(), 800);
    } catch (err) {
      console.warn('📷 Camera permission not available:', err);
      setCameraGranted(false);
      // Auto-proceed anyway after 2 seconds — SmileID widget handles its own camera request
      setTimeout(() => launchWidget(), 2000);
    }
  };

  // Launch the SmileID widget
  const launchWidget = async () => {
    setStep('loading');
    setError(null);
    setIframeLoaded(false);

    try {
      const token = authAPI.getToken();

      // Request fresh verification link with theme customization
      const response = await fetch(
        `${SERVER_URL}/smile-callback-handler`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': ANON_KEY,
          },
          body: JSON.stringify({
            job_id: `kyc-${userId}-${Date.now()}`,
            product: 'biometric_kyc',
            // SmileID theme customization params
            partner_details: {
              name: BORDERPAY_SMILEID_THEME.partner_name,
              theme_color: BORDERPAY_SMILEID_THEME.theme_color,
              logo: BORDERPAY_SMILEID_THEME.logo_url,
            },
            customization: {
              theme_color: BORDERPAY_SMILEID_THEME.theme_color,
              accent_color: BORDERPAY_SMILEID_THEME.accent_color,
              button_color: BORDERPAY_SMILEID_THEME.button_color,
              button_text_color: BORDERPAY_SMILEID_THEME.button_text_color,
            }
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        console.log('📨 SmileID Response:', data);

        const link = data.data?.web_url || data.data?.mobile_url ||
                     data.data?.smile_link || data.data?.verification_url ||
                     data.data?.link;

        if (link) {
          setVerificationUrl(appendSmileIDThemeParams(link));
          setStep('widget');
          startPolling();
          startTimer();
          return;
        }
      }

      // Fallback to sandbox URL with theme params
      console.log('ℹ️ Using SmileID sandbox widget URL');
      setVerificationUrl(appendSmileIDThemeParams(SMILEID_SANDBOX_URL));
      setStep('widget');
      startPolling();
      startTimer();

    } catch (err: any) {
      console.warn('⚠️ Backend failed, using sandbox:', err.message);
      setVerificationUrl(appendSmileIDThemeParams(SMILEID_SANDBOX_URL));
      setStep('widget');
      startPolling();
      startTimer();
    }
  };

  const handleIframeLoad = () => {
    setIframeLoaded(true);
    console.log('✅ SmileID widget loaded');

    // Inject CSS to theme the SmileID widget (best effort — cross-origin may block)
    try {
      const iframe = iframeRef.current;
      if (iframe?.contentDocument) {
        const style = iframe.contentDocument.createElement('style');
        style.textContent = `
          :root {
            --smile-primary: #C7FF00 !important;
            --smile-primary-dark: #A8D600 !important;
            --smile-accent: #C7FF00 !important;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
          }
          .smile-btn-primary, 
          button[class*="primary"],
          .btn-primary,
          [class*="PrimaryButton"],
          [class*="primaryButton"],
          [data-testid="continue-button"],
          [class*="ContinueButton"] {
            background-color: #C7FF00 !important;
            background: #C7FF00 !important;
            color: #0B0E11 !important;
            border-color: #C7FF00 !important;
            border-radius: 9999px !important;
            font-weight: 700 !important;
          }
          .smile-btn-primary:hover,
          button[class*="primary"]:hover,
          .btn-primary:hover {
            background-color: #B8F000 !important;
            background: #B8F000 !important;
          }
          a, .smile-link, [class*="link"] {
            color: #C7FF00 !important;
          }
          [class*="progress"], [class*="Progress"],
          [role="progressbar"] > div {
            background-color: #C7FF00 !important;
          }
          [class*="check"], [class*="Check"],
          [class*="success"] svg {
            color: #C7FF00 !important;
            fill: #C7FF00 !important;
          }
          [class*="Header"], [class*="header"] {
            border-bottom-color: rgba(199, 255, 0, 0.2) !important;
          }
          input[type="radio"]:checked + *,
          input[type="checkbox"]:checked + * {
            border-color: #C7FF00 !important;
          }
          input[type="radio"]:checked::before {
            background-color: #C7FF00 !important;
          }
          *:focus-visible {
            outline-color: #C7FF00 !important;
            box-shadow: 0 0 0 2px rgba(199, 255, 0, 0.3) !important;
          }
          [class*="selected"], [class*="Selected"],
          [class*="active"], [aria-selected="true"] {
            border-color: #C7FF00 !important;
            box-shadow: 0 0 0 2px rgba(199, 255, 0, 0.2) !important;
          }
          .smile-btn-secondary,
          button[class*="secondary"],
          .btn-secondary {
            border-color: #C7FF00 !important;
            color: #C7FF00 !important;
          }
          [class*="oval"], [class*="Oval"],
          [class*="capture-area"], [class*="CaptureArea"] {
            border-color: #C7FF00 !important;
          }
        `;
        iframe.contentDocument.head.appendChild(style);
        console.log('🎨 SmileID theme CSS injected');
      }
    } catch (e) {
      console.log('🎨 Cross-origin: CSS injection not possible (expected)');
    }
  };

  const handleRetry = () => {
    stopPolling();
    if (timerRef.current) clearInterval(timerRef.current);
    setStep('intro');
    setError(null);
    setVerificationUrl(null);
    setIframeLoaded(false);
    setElapsedSeconds(0);
  };

  const handleManualComplete = () => {
    setStep('processing');
    toast.info('Checking verification status...');
    checkVerificationStatus().then(() => {
      startPolling();
      setTimeout(() => {
        stopPolling();
        setStep(current => {
          if (current === 'processing') {
            toast.info("Verification is being processed. You'll be notified.");
            setTimeout(() => onComplete(), 500);
          }
          return current;
        });
      }, 30000);
    });
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Step progress config
  const stepProgress: Record<VerificationStep, number> = {
    intro: 0, permissions: 15, loading: 30, widget: 55, processing: 80, success: 100, failed: 55
  };

  const verificationSteps = [
    { id: 1, label: 'Prepare', icon: FileText },
    { id: 2, label: 'Scan ID', icon: Camera },
    { id: 3, label: 'Selfie', icon: Eye },
    { id: 4, label: 'Done', icon: CheckCircle },
  ];

  const activeStepIndex = step === 'intro' || step === 'permissions' ? 0
    : step === 'loading' ? 1
    : step === 'widget' ? 2
    : step === 'processing' ? 3
    : step === 'success' ? 4
    : 2;

  return (
    <div className="min-h-screen bg-[#0B0E11] text-white flex flex-col">
      {/* ── Header ── */}
      <div className="sticky top-0 z-30 bg-[#0B0E11]/95 backdrop-blur-xl border-b border-[#C7FF00]/10">
        <div className="flex items-center justify-between px-4 py-2.5 pt-safe">
          <button
            onClick={step === 'widget' ? handleRetry : onBack}
            className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors active:scale-95"
          >
            {step === 'widget' ? <X size={16} /> : <ArrowLeft size={16} />}
          </button>

          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-[#C7FF00]" />
            <span className="text-xs font-bold tracking-wide">
              {step === 'widget' ? 'VERIFYING' : 'KYC VERIFICATION'}
            </span>
            {step === 'widget' && (
              <span className="text-[9px] font-mono text-[#C7FF00]/70 bg-[#C7FF00]/10 px-1.5 py-0.5 rounded">
                {formatTime(elapsedSeconds)}
              </span>
            )}
          </div>

          <div className="w-8 flex items-center justify-center">
            {(step === 'widget' || step === 'processing') && (
              <div className="w-2 h-2 rounded-full bg-[#C7FF00] animate-pulse" />
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-[2px] bg-white/5">
          <motion.div
            className="h-full bg-gradient-to-r from-[#C7FF00] to-[#A8D600]"
            initial={{ width: '0%' }}
            animate={{ width: `${stepProgress[step]}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <AnimatePresence mode="wait">

          {/* ═══ STEP 1: INTRO ═══ */}
          {step === 'intro' && (
            <motion.div
              key="intro"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-1 px-5 py-5 overflow-y-auto"
            >
              {/* Hero */}
              <div className="relative flex flex-col items-center mb-6">
                <motion.div
                  className="absolute w-28 h-28 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(199,255,0,0.15) 0%, transparent 70%)' }}
                  animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
                  transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                />
                <div className="w-18 h-18 rounded-full bg-gradient-to-br from-[#C7FF00]/20 to-[#C7FF00]/5 border border-[#C7FF00]/30 flex items-center justify-center relative z-10" style={{ width: 72, height: 72 }}>
                  <Fingerprint className="w-9 h-9 text-[#C7FF00]" strokeWidth={1.5} />
                </div>
                <h2 className="text-lg font-extrabold mt-4 tracking-tight">Verify Your Identity</h2>
                <p className="text-[11px] text-gray-400 text-center mt-1 max-w-[260px] leading-relaxed">
                  Quick & secure ID verification powered by SmileID
                </p>
              </div>

              {/* Step indicators */}
              <div className="flex items-center justify-between px-2 mb-6">
                {verificationSteps.map((vs, i) => (
                  <div key={vs.id} className="contents">
                    <div className="flex flex-col items-center gap-1.5">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center border transition-all ${
                        i === 0
                          ? 'bg-[#C7FF00] border-[#C7FF00] text-[#0B0E11]'
                          : 'bg-white/5 border-white/10 text-gray-500'
                      }`}>
                        <vs.icon size={16} />
                      </div>
                      <span className={`text-[9px] font-semibold ${i === 0 ? 'text-[#C7FF00]' : 'text-gray-600'}`}>
                        {vs.label}
                      </span>
                    </div>
                    {i < verificationSteps.length - 1 && (
                      <div className="flex-1 h-[1px] bg-white/10 mx-1 mb-4" />
                    )}
                  </div>
                ))}
              </div>

              {/* Benefits Card */}
              <div className="bg-gradient-to-br from-[#C7FF00]/8 to-transparent border border-[#C7FF00]/15 rounded-2xl p-4 mb-3">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-3.5 h-3.5 text-[#C7FF00]" />
                  <span className="text-[11px] font-bold text-[#C7FF00] uppercase tracking-wider">Unlock Premium</span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { icon: '\uD83D\uDCB3', text: 'Virtual Cards' },
                    { icon: '\uD83C\uDF0D', text: "Int'l Transfers" },
                    { icon: '\uD83D\uDCC8', text: 'Higher Limits' },
                    { icon: '\u2728', text: 'Verified Badge' },
                  ].map((b, i) => (
                    <div key={i} className="flex items-center gap-2 bg-white/3 rounded-lg px-2.5 py-2">
                      <span className="text-sm">{b.icon}</span>
                      <span className="text-[10px] text-white/80 font-medium">{b.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Requirements Card */}
              <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-4 mb-3">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 block">What You Need</span>
                <div className="space-y-2.5">
                  <RequirementRow icon={Camera} title="Camera Access" subtitle="For selfie capture" />
                  <RequirementRow icon={FileText} title="Valid Government ID" subtitle="Passport, National ID, or License" />
                  <RequirementRow icon={Wifi} title="Stable Connection" subtitle="For real-time verification" />
                </div>
              </div>

              {/* Security Badge */}
              <div className="flex items-center gap-2.5 bg-[#C7FF00]/5 border border-[#C7FF00]/10 rounded-xl px-3 py-2.5 mb-5">
                <Lock className="w-3.5 h-3.5 text-[#C7FF00]/70 flex-shrink-0" />
                <p className="text-[9px] text-[#C7FF00]/60 leading-relaxed">
                  End-to-end encrypted. Your biometric data is processed by SmileID and never stored on our servers.
                </p>
              </div>

              {/* CTA */}
              <motion.button
                onClick={checkCameraPermission}
                className="w-full relative overflow-hidden bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-full font-extrabold text-[13px] tracking-wide flex items-center justify-center gap-2.5 transition-transform"
                whileTap={{ scale: 0.97 }}
              >
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent"
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut', repeatDelay: 1 }}
                  style={{ width: '50%' }}
                />
                <ShieldCheck size={18} className="relative z-10" />
                <span className="relative z-10">Begin Verification</span>
                <ChevronRight size={16} className="relative z-10" />
              </motion.button>

              <button
                onClick={onBack}
                className="w-full text-gray-600 py-3 text-[10px] font-medium hover:text-gray-400 transition-colors"
              >
                I'll do this later
              </button>
            </motion.div>
          )}

          {/* ═══ STEP 1.5: CAMERA PERMISSION ═══ */}
          {step === 'permissions' && (
            <motion.div
              key="permissions"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center px-6"
            >
              <motion.div
                animate={cameraGranted === null ? { scale: [1, 1.05, 1] } : {}}
                transition={{ repeat: Infinity, duration: 2 }}
                className={`w-20 h-20 rounded-full flex items-center justify-center mb-5 ${
                  cameraGranted === true ? 'bg-[#C7FF00]/20' :
                  cameraGranted === 'bg-[#C7FF00]/10'
                }`}
              >
                {cameraGranted === null && <Camera className="w-9 h-9 text-[#C7FF00]" />}
                {cameraGranted === true && <CheckCircle className="w-9 h-9 text-[#C7FF00]" />}
                {cameraGranted === false && <AlertCircle className="w-9 h-9 text-red-400" />}
              </motion.div>

              {cameraGranted === null && (
                <>
                  <h3 className="text-base font-bold mb-1.5">Camera Access Required</h3>
                  <p className="text-[11px] text-gray-400 text-center max-w-[240px]">
                    Please allow camera access when prompted to continue with verification
                  </p>
                  <Loader2 className="w-5 h-5 text-[#C7FF00] animate-spin mt-4" />
                </>
              )}

              {cameraGranted === true && (
                <>
                  <h3 className="text-base font-bold text-[#C7FF00] mb-1.5">Camera Ready</h3>
                  <p className="text-[11px] text-gray-400">Launching verification widget...</p>
                </>
              )}

              {cameraGranted === false && (
                <>
                  <h3 className="text-base font-bold text-red-400 mb-1.5">Camera Blocked</h3>
                  <p className="text-[11px] text-gray-400 text-center max-w-[260px] mb-5">
                    Camera access is needed for selfie verification. Please enable it in your browser settings and try again.
                  </p>
                  <button
                    onClick={() => { setCameraGranted(null); checkCameraPermission(); }}
                    className="bg-[#C7FF00] text-[#0B0E11] px-6 py-2.5 rounded-full text-xs font-bold active:scale-95 transition-transform mb-2"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={() => launchWidget()}
                    className="text-[#C7FF00]/60 text-[10px] font-medium py-2"
                  >
                    Continue anyway
                  </button>
                </>
              )}
            </motion.div>
          )}

          {/* ═══ STEP 2: LOADING ═══ */}
          {step === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center px-6"
            >
              {/* Animated scanner effect */}
              <div className="relative w-24 h-24 mb-6">
                <motion.div
                  className="absolute inset-0 rounded-2xl border-2 border-[#C7FF00]/30"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
                />
                <motion.div
                  className="absolute inset-2 rounded-xl border border-[#C7FF00]/20"
                  animate={{ rotate: -360 }}
                  transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Fingerprint className="w-10 h-10 text-[#C7FF00]" strokeWidth={1.5} />
                </div>
                {/* Scanning line */}
                <motion.div
                  className="absolute left-2 right-2 h-[2px] bg-gradient-to-r from-transparent via-[#C7FF00] to-transparent"
                  animate={{ top: ['15%', '85%', '15%'] }}
                  transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
                />
              </div>

              <h3 className="text-sm font-bold mb-1">Preparing Verification</h3>
              <p className="text-[10px] text-gray-500 mb-4">Establishing secure connection...</p>

              {/* Loading steps */}
              <div className="space-y-2 w-full max-w-[220px]">
                <LoadingStep label="Authenticating session" done delay={0} />
                <LoadingStep label="Connecting to SmileID" done={false} delay={0.5} />
                <LoadingStep label="Loading widget" done={false} delay={1} />
              </div>
            </motion.div>
          )}

          {/* ═══ STEP 3: WIDGET — Themed iframe embed ═══ */}
          {step === 'widget' && verificationUrl && (
            <motion.div
              key="widget"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col"
            >
              {/* Branded info strip */}
              <div className="px-3 py-1.5 bg-gradient-to-r from-[#C7FF00]/10 via-[#C7FF00]/5 to-transparent border-b border-[#C7FF00]/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#C7FF00] animate-pulse" />
                    <span className="text-[9px] text-[#C7FF00]/80 font-semibold uppercase tracking-wider">
                      Secure Session Active
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5 text-[#C7FF00]/50" />
                    <span className="text-[8px] text-[#C7FF00]/40 font-mono">TLS 1.3</span>
                  </div>
                </div>
              </div>

              {/* Iframe container with branded border */}
              <div className="flex-1 relative">
                {/* Corner accents */}
                <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[#C7FF00]/40 rounded-tl z-10 pointer-events-none" />
                <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[#C7FF00]/40 rounded-tr z-10 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[#C7FF00]/40 rounded-bl z-10 pointer-events-none" />
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[#C7FF00]/40 rounded-br z-10 pointer-events-none" />

                {/* Loading overlay */}
                <AnimatePresence>
                  {!iframeLoaded && (
                    <motion.div
                      initial={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.4 }}
                      className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0B0E11]"
                    >
                      <div className="relative w-16 h-16 mb-4">
                        <motion.div
                          className="absolute inset-0 rounded-full border-2 border-[#C7FF00]/20"
                          animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                          transition={{ repeat: Infinity, duration: 1.5 }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <BorderPayLogo size={32} color="#ffffff" className="animate-pulse" />
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-400 font-medium">Loading SmileID Widget</p>
                      <div className="flex gap-1 mt-2">
                        {[0, 1, 2].map(i => (
                          <motion.div
                            key={i}
                            className="w-1.5 h-1.5 rounded-full bg-[#C7FF00]"
                            animate={{ opacity: [0.2, 1, 0.2] }}
                            transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <iframe
                  ref={iframeRef}
                  src={verificationUrl}
                  onLoad={handleIframeLoad}
                  allow="camera *; microphone *; geolocation *"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-top-navigation"
                  className="w-full h-full border-0"
                  style={{
                    minHeight: 'calc(100vh - 130px)',
                    backgroundColor: '#ffffff',
                  }}
                  title="SmileID Identity Verification"
                />
              </div>

              {/* Bottom bar */}
              <div className="sticky bottom-0 z-10 bg-[#0B0E11] border-t border-[#C7FF00]/10 px-4 py-2.5 pb-safe">
                <button
                  onClick={handleManualComplete}
                  className="w-full bg-[#C7FF00] text-[#0B0E11] py-2.5 rounded-full font-bold text-[11px] tracking-wide flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
                >
                  <CheckCircle size={14} />
                  I've Completed Verification
                </button>
                <div className="flex items-center justify-center gap-3 mt-2">
                  <button
                    onClick={handleRetry}
                    className="text-gray-600 text-[9px] font-medium hover:text-gray-400 transition-colors"
                  >
                    Restart
                  </button>
                  <span className="text-gray-800">&middot;</span>
                  <button
                    onClick={onBack}
                    className="text-gray-600 text-[9px] font-medium hover:text-gray-400 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ═══ STEP 4: PROCESSING ═══ */}
          {step === 'processing' && (
            <motion.div
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center px-6"
            >
              {/* DNA helix spinner */}
              <div className="relative w-20 h-20 mb-5">
                <motion.div
                  className="absolute inset-0 rounded-full border-2 border-[#C7FF00]/30 border-t-[#C7FF00]"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                />
                <motion.div
                  className="absolute inset-2 rounded-full border-2 border-[#C7FF00]/20 border-b-[#C7FF00]/60"
                  animate={{ rotate: -360 }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <ShieldCheck className="w-7 h-7 text-[#C7FF00]" />
                </div>
              </div>

              <h3 className="text-sm font-bold mb-1.5">Processing Verification</h3>
              <p className="text-[10px] text-gray-500 text-center max-w-[240px] mb-5">
                Securely confirming your identity. This usually takes less than a minute.
              </p>

              <div className="w-full max-w-[220px] space-y-2">
                <LoadingStep label="Analyzing document" done delay={0} />
                <LoadingStep label="Matching biometrics" done={false} delay={0.8} />
                <LoadingStep label="Confirming identity" done={false} delay={1.6} />
              </div>
            </motion.div>
          )}

          {/* ═══ STEP 5: SUCCESS ═══ */}
          {step === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center px-6"
            >
              {/* Confetti burst effect */}
              <div className="relative">
                {[...Array(8)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: i % 2 === 0 ? '#C7FF00' : '#FFFFFF',
                      top: '50%', left: '50%',
                    }}
                    initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                    animate={{
                      x: Math.cos((i * Math.PI * 2) / 8) * 60,
                      y: Math.sin((i * Math.PI * 2) / 8) * 60,
                      opacity: 0,
                      scale: 0,
                    }}
                    transition={{ duration: 0.8, delay: 0.3 + i * 0.05, ease: 'easeOut' }}
                  />
                ))}

                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ duration: 0.4, ease: 'easeOut', delay: 0.1 }}
                  className="w-24 h-24 rounded-full bg-gradient-to-br from-[#C7FF00]/30 to-[#C7FF00]/10 border-2 border-[#C7FF00]/40 flex items-center justify-center relative z-10"
                >
                  <CheckCircle className="w-12 h-12 text-[#C7FF00]" strokeWidth={2} />
                </motion.div>
              </div>

              <div className="text-center mt-5">
                <h2 className="text-xl font-extrabold text-white mb-1.5">Verified!</h2>
                <p className="text-[11px] text-gray-400 max-w-[240px] mb-5">
                  Your identity has been confirmed. All premium features are now unlocked.
                </p>

                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.8 }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-full"
                >
                  <ShieldCheck className="w-4 h-4 text-[#C7FF00]" />
                  <span className="text-xs text-[#C7FF00] font-bold">KYC Level 2 — Verified</span>
                </motion.div>
              </div>
            </motion.div>
          )}

          {/* ═══ STEP 6: FAILED ═══ */}
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
                className="w-20 h-20 rounded-full bg-red-500/15 border border-red-500/20 flex items-center justify-center mb-5"
              >
                <AlertCircle className="w-10 h-10 text-red-400" />
              </motion.div>

              <h2 className="text-base font-bold text-white mb-1.5">Verification Failed</h2>
              <p className="text-[11px] text-gray-400 text-center max-w-[250px] mb-1.5">
                {error || 'We could not verify your identity.'}
              </p>
              <p className="text-[9px] text-gray-600 text-center max-w-[220px] mb-6">
                Ensure your ID is fully visible, well-lit, and your selfie is clear.
              </p>

              <div className="w-full max-w-[260px] space-y-2.5">
                <button
                  onClick={handleRetry}
                  className="w-full bg-[#C7FF00] text-[#0B0E11] py-3 rounded-full font-bold text-xs flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
                >
                  <RefreshCw size={14} />
                  Try Again
                </button>
                <button
                  onClick={onBack}
                  className="w-full text-gray-500 py-2.5 text-[10px] font-medium hover:text-gray-300 transition-colors"
                >
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

// ── Sub-components ──

function RequirementRow({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-[#C7FF00]/8 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-[#C7FF00]/60" />
      </div>
      <div>
        <p className="text-[11px] text-white font-semibold">{title}</p>
        <p className="text-[9px] text-gray-500">{subtitle}</p>
      </div>
    </div>
  );
}

function LoadingStep({ label, done, delay = 0 }: { label: string; done: boolean; delay?: number }) {
  const [active, setActive] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setActive(true), delay * 1000);
    const t2 = setTimeout(() => {
      if (done) setCompleted(true);
    }, (delay + 1.2) * 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [delay, done]);

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: active ? 1 : 0.3, x: active ? 0 : -8 }}
      transition={{ duration: 0.3 }}
      className="flex items-center gap-2.5"
    >
      {completed ? (
        <CheckCircle className="w-3.5 h-3.5 text-[#C7FF00] flex-shrink-0" />
      ) : active ? (
        <Loader2 className="w-3.5 h-3.5 text-[#C7FF00] animate-spin flex-shrink-0" />
      ) : (
        <div className="w-3.5 h-3.5 rounded-full border border-white/20 flex-shrink-0" />
      )}
      <span className={`text-[10px] font-medium ${
        completed ? 'text-[#C7FF00]' : active ? 'text-white' : 'text-gray-600'
      }`}>
        {label}
      </span>
    </motion.div>
  );
}