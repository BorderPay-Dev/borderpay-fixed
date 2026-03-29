/**
 * BorderPay Africa — KYC Verification Screen
 *
 * Uses SmileID smart-camera-web v11 component for document verification:
 *   1. Welcome — overview of benefits + requirements
 *   2. Document Select — choose ID type
 *   3. smart-camera-web — native camera capture (selfie + ID document)
 *   4. Processing — images uploaded to SmileID via backend
 *   5. Result — success or failure
 *
 * Backend: smile-callback-handler handles token generation, image upload to
 * SmileID, and receives verification callbacks.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BASE_URL, ANON_KEY, storeUserProfile, readUserProfile, dataCache } from '../../utils/supabase/client';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck, ArrowLeft, Camera, FileText, AlertCircle,
  CheckCircle, Loader2, RefreshCw, Fingerprint,
  Lock, Eye, ChevronRight, Wifi, CreditCard, Globe,
  Smartphone, UserCheck, Scan, Shield, Star,
  ArrowRight, Zap, BadgeCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { authAPI, supabase } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KYCVerificationProps {
  userId: string;
  userEmail: string;
  onBack: () => void;
  onComplete: () => void;
}

type KYCStep = 'welcome' | 'doc-select' | 'loading' | 'capture' | 'uploading' | 'processing' | 'success' | 'failed';

// ─── Constants ───────────────────────────────────────────────────────────────

interface DocOption {
  id: string;        // SmileID id_type value
  label: string;
  desc: string;
  icon: typeof FileText;
}

// SmileID supported document types per country
// Covers all 35 BorderPay allowed countries (31 African + US, CA, UK, FR)
const DOC_TYPES_BY_COUNTRY: Record<string, DocOption[]> = {
  // ── West Africa ─────────────────────────────────────────────────────────────
  NG: [
    { id: 'PASSPORT', label: 'International Passport', desc: 'Valid travel passport', icon: Globe },
    { id: 'NIN_V2', label: 'National ID (NIN)', desc: 'National Identity Number', icon: CreditCard },
    { id: 'DRIVERS_LICENSE', label: "Driver's License", desc: 'Government-issued license', icon: Smartphone },
    { id: 'VOTER_ID', label: "Voter's Card", desc: 'Electoral registration card', icon: UserCheck },
  ],
  GH: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Ghanaian or foreign passport', icon: Globe },
    { id: 'DRIVERS_LICENSE', label: "Driver's License", desc: 'Ghana driving licence', icon: Smartphone },
    { id: 'VOTER_ID', label: "Voter's Card", desc: 'Electoral commission card', icon: UserCheck },
    { id: 'SSNIT', label: 'SSNIT Card', desc: 'Social Security card', icon: CreditCard },
  ],
  SN: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Senegalese or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'Carte nationale d\'identité', desc: 'National ID card', icon: CreditCard },
  ],
  BJ: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Beninese or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Carte d\'identité nationale', icon: CreditCard },
  ],
  BF: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Burkinabé or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'CNIB', desc: 'Carte nationale d\'identité', icon: CreditCard },
  ],
  CV: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Cape Verdean or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Bilhete de identidade', icon: CreditCard },
  ],
  GM: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Gambian or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Gambian identity card', icon: CreditCard },
  ],
  NE: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Nigerien or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Carte d\'identité nationale', icon: CreditCard },
  ],
  // ── East Africa ─────────────────────────────────────────────────────────────
  KE: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Kenyan or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Kenyan National ID card', icon: CreditCard },
    { id: 'ALIEN_CARD', label: 'Alien Card', desc: 'Foreign resident card', icon: UserCheck },
  ],
  TZ: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Tanzanian or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID (NIDA)', desc: 'NIDA identity card', icon: CreditCard },
    { id: 'DRIVERS_LICENSE', label: "Driver's License", desc: 'TZ driving licence', icon: Smartphone },
    { id: 'VOTER_ID', label: "Voter's Card", desc: 'NEC voter registration', icon: UserCheck },
  ],
  UG: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Ugandan or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID_NO_PHOTO', label: 'National ID', desc: 'Ugandan National ID', icon: CreditCard },
  ],
  RW: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Rwandan or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Rwandan ID card', icon: CreditCard },
  ],
  DJ: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Djiboutian or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Carte d\'identité nationale', icon: CreditCard },
  ],
  KM: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Comorian or foreign passport', icon: Globe },
  ],
  MG: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Malagasy or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Carte d\'identité nationale', icon: CreditCard },
  ],
  MW: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Malawian or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Malawian national ID', icon: CreditCard },
  ],
  SC: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Seychellois or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Identity card', icon: CreditCard },
  ],
  // ── Central Africa ──────────────────────────────────────────────────────────
  CM: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Cameroonian or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'CNI / Carte nationale', icon: CreditCard },
  ],
  GA: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Gabonese or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Carte d\'identité nationale', icon: CreditCard },
  ],
  TD: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Chadian or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Carte d\'identité nationale', icon: CreditCard },
  ],
  ST: [
    { id: 'PASSPORT', label: 'Passport', desc: 'São Toméan or foreign passport', icon: Globe },
  ],
  // ── Southern Africa ─────────────────────────────────────────────────────────
  ZA: [
    { id: 'PASSPORT', label: 'Passport', desc: 'South African or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'South African ID card', icon: CreditCard },
    { id: 'DRIVERS_LICENSE', label: "Driver's License", desc: 'SA driving licence', icon: Smartphone },
  ],
  MZ: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Mozambican or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Bilhete de identidade', icon: CreditCard },
  ],
  BW: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Botswanan or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'Omang ID', desc: 'Botswana national ID card', icon: CreditCard },
  ],
  NA: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Namibian or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Namibian identity card', icon: CreditCard },
  ],
  SZ: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Eswatini or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Eswatini identity card', icon: CreditCard },
  ],
  LS: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Basotho or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Lesotho identity card', icon: CreditCard },
  ],
  MU: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Mauritian or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Mauritian identity card', icon: CreditCard },
  ],
  // ── North Africa ────────────────────────────────────────────────────────────
  EG: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Egyptian or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Egyptian national ID', icon: CreditCard },
  ],
  MA: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Moroccan or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'CNIE', desc: 'Carte nationale d\'identité', icon: CreditCard },
    { id: 'DRIVERS_LICENSE', label: 'Permis de conduire', desc: 'Moroccan driving licence', icon: Smartphone },
  ],
  TN: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Tunisian or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'CIN', desc: 'Carte d\'identité nationale', icon: CreditCard },
  ],
  DZ: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Algerian or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Carte nationale d\'identité', icon: CreditCard },
  ],
  MR: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Mauritanian or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'National ID', desc: 'Carte d\'identité nationale', icon: CreditCard },
  ],
  // ── Global ──────────────────────────────────────────────────────────────────
  GB: [
    { id: 'PASSPORT', label: 'Passport', desc: 'UK or foreign passport', icon: Globe },
    { id: 'DRIVERS_LICENSE', label: "Driver's License", desc: 'DVLA driving licence', icon: Smartphone },
  ],
  US: [
    { id: 'PASSPORT', label: 'Passport', desc: 'US or foreign passport', icon: Globe },
    { id: 'DRIVERS_LICENSE', label: "Driver's License", desc: 'State-issued licence', icon: Smartphone },
  ],
  CA: [
    { id: 'PASSPORT', label: 'Passport', desc: 'Canadian or foreign passport', icon: Globe },
    { id: 'DRIVERS_LICENSE', label: "Driver's License", desc: 'Provincial licence', icon: Smartphone },
  ],
  FR: [
    { id: 'PASSPORT', label: 'Passeport', desc: 'French or foreign passport', icon: Globe },
    { id: 'NATIONAL_ID', label: 'Carte d\'identité', desc: 'French national ID', icon: CreditCard },
    { id: 'DRIVERS_LICENSE', label: 'Permis de conduire', desc: 'French driving licence', icon: Smartphone },
  ],
};

// Fallback for any unlisted country
const DEFAULT_DOC_TYPES: DocOption[] = [
  { id: 'PASSPORT', label: 'International Passport', desc: 'Valid travel passport', icon: Globe },
];

function getDocTypesForCountry(countryCode: string): DocOption[] {
  return DOC_TYPES_BY_COUNTRY[countryCode] || DEFAULT_DOC_TYPES;
}

const UNLOCK_FEATURES = [
  { icon: CreditCard, label: 'Virtual & Physical Cards', color: 'from-yellow-400/20 to-yellow-600/5' },
  { icon: Globe, label: 'International Transfers', color: 'from-blue-400/20 to-blue-600/5' },
  { icon: Zap, label: 'Instant Settlements', color: 'from-purple-400/20 to-purple-600/5' },
  { icon: Star, label: 'Higher Transaction Limits', color: 'from-green-400/20 to-green-600/5' },
];

const STEPS_CONFIG = [
  { label: 'Document', icon: FileText },
  { label: 'Scan ID', icon: Scan },
  { label: 'Selfie', icon: Eye },
  { label: 'Verified', icon: BadgeCheck },
];

// ─── Main Component ──────────────────────────────────────────────────────────

export function KYCVerification({ userId, userEmail, onBack, onComplete }: KYCVerificationProps) {
  const [step, setStep] = useState<KYCStep>('welcome');
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null); // SmileID id_type
  const [userCountry, setUserCountry] = useState<string>('NG');
  const [error, setError] = useState<string | null>(null);
  const [sdkConfig, setSdkConfig] = useState<any>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const cameraRef = useRef<HTMLDivElement>(null);

  // Load user's country from profile
  useEffect(() => {
    try {
      const user = readUserProfile();
      if (user?.country) setUserCountry(user.country);
    } catch {}
    // Also fetch fresh from API
    backendAPI.user.getProfile().then(result => {
      if (result.success && result.data?.user?.country) {
        setUserCountry(result.data.user.country);
      }
    }).catch(() => {});
  }, []);

  const docOptions = getDocTypesForCountry(userCountry);

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
    // Stop after 12 polls (2 minutes at 10s intervals)
    pollCountRef.current += 1;
    if (pollCountRef.current > 12) {
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
    // Poll every 10 seconds (backend actively checks SmileID Job Status API)
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

  // ─── Initialize: get token from backend ────────────────────────────────────

  const initializeVerification = async () => {
    setStep('loading');
    setError(null);

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
          id_type: selectedDoc || 'PASSPORT',
          country: userCountry,
        }),
      });

      if (!response.ok) throw new Error('Failed to initialize verification');

      const result = await response.json();
      if (!result.success || !result.data) {
        if (result.data?.already_verified) {
          handleVerificationDone('success');
          return;
        }
        throw new Error('Backend returned no data');
      }

      // Validate that any URLs in the config point to trusted SmileID origins
      const TRUSTED_ORIGINS = ['smileidentity.com', 'usesmileid.com', 'supabase.co'];
      if (result.data.smile_api) {
        try {
          const apiHost = new URL(result.data.smile_api).hostname;
          if (!TRUSTED_ORIGINS.some(t => apiHost.endsWith(t))) {
            throw new Error('Untrusted verification provider URL');
          }
        } catch (urlErr: any) {
          if (urlErr.message === 'Untrusted verification provider URL') throw urlErr;
          // Malformed URL — reject
          throw new Error('Invalid verification provider URL');
        }
      }

      setSdkConfig(result.data);
      setStep('capture');
    } catch (err: any) {
      console.error('Init error:', err);
      setStep('failed');
      setError(err.message || 'Could not start verification.');
      toast.error('Could not start verification');
    }
  };

  // ─── Handle smart-camera-web events ────────────────────────────────────────

  useEffect(() => {
    if (step !== 'capture' || !cameraRef.current) return;

    const container = cameraRef.current;
    const el = container.querySelector('smart-camera-web');
    if (!el) return;

    const handleImagesComputed = async (event: any) => {
      const detail = event.detail;
      if (!detail?.images) return;

      setStep('uploading');

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
            action: 'submit_images',
            images: detail.images,
            id_type: selectedDoc || 'PASSPORT',
            country: userCountry,
            job_id: sdkConfig?.job_id,
          }),
        });

        const result = await response.json();

        if (result.success) {
          setStep('processing');

          // Send 'submitted' KYC status email (fire-and-forget)
          fetch(`${BASE_URL}/send-kyc-status-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': ANON_KEY },
            body: JSON.stringify({ type: 'submitted', userId }),
          }).catch(() => {});

          // First check after 5s, then poll every 10s (max 12 polls = 2 min)
          setTimeout(() => checkVerificationStatus(), 5000);
          startPolling();
        } else {
          setStep('failed');
          setError(result.error || 'Upload failed. Please try again.');
          toast.error('Upload failed');
        }
      } catch (err: any) {
        setStep('failed');
        setError(err.message || 'Upload failed.');
        toast.error('Upload failed');
      }
    };

    const handleClose = () => {
      setStep('doc-select');
    };

    // Listen for both legacy and current SmileID event names
    el.addEventListener('imagesComputed', handleImagesComputed);
    el.addEventListener('smart-camera-web.publish', handleImagesComputed);
    el.addEventListener('close', handleClose);

    return () => {
      el.removeEventListener('imagesComputed', handleImagesComputed);
      el.removeEventListener('smart-camera-web.publish', handleImagesComputed);
      el.removeEventListener('close', handleClose);
    };
  }, [step, sdkConfig, selectedDoc]);

  const handleRetry = () => {
    stopPolling();
    setStep('welcome');
    setSelectedDoc(null);
    setError(null);
    setSdkConfig(null);
  };

  // ── Step progress ──
  const activeStepIdx =
    step === 'welcome' || step === 'doc-select' ? 0 :
    step === 'loading' || step === 'capture' ? 1 :
    step === 'uploading' ? 2 :
    step === 'processing' ? 3 :
    step === 'success' ? 4 : 2;

  const progressPct: Record<KYCStep, number> = {
    welcome: 0, 'doc-select': 12, loading: 25,
    capture: 50, uploading: 70, processing: 85, success: 100, failed: 60,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-[#0B0E11] text-white flex flex-col pb-safe">
      {/* ── Header ── */}
      <div className="sticky top-0 z-30 bg-[#0B0E11]/95 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="flex items-center justify-between px-4 py-3 pt-safe">
          <button
            onClick={step === 'capture' ? () => setStep('doc-select') : onBack}
            className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center hover:bg-white/10 transition-all active:scale-90"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="flex items-center gap-2">
            <Shield size={14} className="text-[#C7FF00]" />
            <span className="text-[11px] font-bold tracking-widest uppercase">
              {step === 'capture' ? 'Scan & Capture' : step === 'uploading' ? 'Uploading' : 'Identity Verification'}
            </span>
          </div>

          <div className="w-9 flex items-center justify-center">
            {(step === 'capture' || step === 'uploading' || step === 'processing') && (
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
      {step !== 'capture' && step !== 'success' && step !== 'failed' && step !== 'uploading' && (
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
      <div className="flex-1 flex flex-col overflow-y-auto">
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
                      <f.icon className="w-4 h-4 text-white/70 flex-shrink-0" />
                      <span className="text-[10px] text-white/80 font-medium leading-tight">{f.label}</span>
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-4 mb-4">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-3 block">What You'll Need</span>
                <div className="space-y-3">
                  {[
                    { icon: FileText, title: 'Valid Government ID', sub: 'Passport, NIN, License, or Voter\'s Card' },
                    { icon: Camera, title: 'Camera Access', sub: 'For ID scan and selfie capture' },
                    { icon: Wifi, title: 'Stable Internet', sub: 'For real-time verification processing' },
                  ].map((req, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[#C7FF00]/[0.07] flex items-center justify-center flex-shrink-0">
                        <req.icon className="w-4 h-4 text-[#C7FF00]/70" />
                      </div>
                      <div>
                        <p className="text-[11px] text-white font-semibold">{req.title}</p>
                        <p className="text-[9px] text-gray-500">{req.sub}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2.5 bg-[#C7FF00]/[0.04] border border-[#C7FF00]/[0.08] rounded-xl px-3.5 py-2.5 mb-6">
                <Lock className="w-3.5 h-3.5 text-[#C7FF00]/60 flex-shrink-0" />
                <p className="text-[9px] text-[#C7FF00]/50 leading-relaxed">
                  End-to-end encrypted. Biometric data is processed by SmileID and never stored on BorderPay servers.
                </p>
              </div>
            </motion.div>
          )}

          {/* WELCOME CTA — inside scroll area so always reachable */}
          {step === 'welcome' && (
            <div className="px-5 pt-2 pb-6 pb-safe">
              <motion.button
                onClick={() => setStep('doc-select')}
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

          {/* ═══ DOCUMENT SELECT ═══ */}
          {step === 'doc-select' && (
            <motion.div
              key="doc-select"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="flex-1 px-5 py-4 overflow-y-auto"
            >
              <div className="text-center mb-6">
                <div className="w-14 h-14 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <FileText className="w-7 h-7 text-[#C7FF00]" />
                </div>
                <h2 className="text-lg font-bold mb-1">Select ID Document</h2>
                <p className="text-[11px] text-gray-500 max-w-[250px] mx-auto">
                  Choose the type of government-issued ID you will use for verification
                </p>
              </div>

              <div className="space-y-2.5 mb-6">
                {docOptions.map((doc, i) => {
                  const Icon = doc.icon;
                  return (
                    <motion.button
                      key={doc.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}
                      onClick={() => setSelectedDoc(doc.id)}
                      className={`w-full flex items-center gap-3.5 p-4 rounded-2xl border transition-all text-left active:scale-[0.98] ${
                        selectedDoc === doc.id
                          ? 'bg-[#C7FF00]/10 border-[#C7FF00]/40 shadow-[0_0_20px_rgba(199,255,0,0.08)]'
                          : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                        selectedDoc === doc.id ? 'bg-[#C7FF00]/20' : 'bg-white/[0.04]'
                      }`}>
                        <Icon className={`w-5 h-5 transition-colors ${
                          selectedDoc === doc.id ? 'text-[#C7FF00]' : 'text-gray-500'
                        }`} />
                      </div>
                      <div className="flex-1">
                        <p className={`text-[12px] font-semibold transition-colors ${
                          selectedDoc === doc.id ? 'text-white' : 'text-gray-300'
                        }`}>{doc.label}</p>
                        <p className="text-[9px] text-gray-600">{doc.desc}</p>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                        selectedDoc === doc.id ? 'border-[#C7FF00] bg-[#C7FF00]' : 'border-gray-700'
                      }`}>
                        {selectedDoc === doc.id && <CheckCircle className="w-3 h-3 text-[#0B0E11]" />}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* DOC-SELECT CTA — inside scroll area so always reachable */}
          {step === 'doc-select' && (
            <div className="px-5 pt-2 pb-6 pb-safe">
              <motion.button
                onClick={initializeVerification}
                disabled={!selectedDoc}
                className={`w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                  selectedDoc
                    ? 'bg-[#C7FF00] text-[#0B0E11] active:scale-[0.97]'
                    : 'bg-white/[0.06] text-gray-600 cursor-not-allowed'
                }`}
                whileTap={selectedDoc ? { scale: 0.97 } : undefined}
              >
                <Camera size={16} />
                Continue
                <ChevronRight size={16} />
              </motion.button>
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
                <motion.div
                  className="absolute left-3 right-3 h-[2px] bg-gradient-to-r from-transparent via-[#C7FF00] to-transparent rounded-full"
                  animate={{ top: ['20%', '80%', '20%'] }}
                  transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
                />
              </div>
              <h3 className="text-sm font-bold mb-1.5">Preparing Verification</h3>
              <p className="text-[10px] text-gray-600 mb-5">Establishing secure connection...</p>
              <div className="space-y-2.5 w-full max-w-[240px]">
                <AnimatedLoadingStep label="Authenticating session" delay={0} />
                <AnimatedLoadingStep label="Connecting to SmileID" delay={0.6} />
                <AnimatedLoadingStep label="Initializing camera" delay={1.2} />
              </div>
            </motion.div>
          )}

          {/* ═══ CAPTURE (smart-camera-web) ═══ */}
          {step === 'capture' && (
            <motion.div
              key="capture"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col"
              ref={cameraRef}
            >
              {/* SmileID smart-camera-web component */}
              <div className="flex-1 bg-white rounded-t-2xl overflow-y-auto" style={{ minHeight: 'calc(100vh - 100px)' }}>
                {selectedDoc === 'PASSPORT' ? (
                  // @ts-ignore - custom web component
                  <smart-camera-web
                    document-capture-modes="camera,upload"
                    capture-id="true"
                    hide-back-of-id="true"
                    show-attribution="true"
                    style={{ width: '100%', height: '100%' }}
                  />
                ) : (
                  // @ts-ignore - custom web component
                  <smart-camera-web
                    document-capture-modes="camera,upload"
                    capture-id="true"
                    show-attribution="true"
                    style={{ width: '100%', height: '100%' }}
                  />
                )}
              </div>
            </motion.div>
          )}

          {/* ═══ UPLOADING ═══ */}
          {step === 'uploading' && (
            <motion.div
              key="uploading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center px-6"
            >
              <div className="relative w-24 h-24 mb-6">
                <motion.div
                  className="absolute inset-0 rounded-full border-2 border-[#C7FF00]/20 border-t-[#C7FF00]"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Camera className="w-8 h-8 text-[#C7FF00]" />
                </div>
              </div>
              <h3 className="text-base font-bold mb-1.5">Uploading Images</h3>
              <p className="text-[10px] text-gray-500 text-center max-w-[250px]">
                Securely uploading your ID and selfie to SmileID for verification...
              </p>
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

              <h2 className="text-lg font-bold text-white mb-2 text-center">Document Submitted</h2>
              <p className="text-xs text-gray-400 text-center max-w-[280px] mb-5 leading-relaxed">
                Your identity document has been successfully submitted for review.
              </p>

              <div className="w-full max-w-[300px] bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 mb-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-[#C7FF00]/10 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 text-[#C7FF00] animate-spin" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-white">Under Review</p>
                    <p className="text-[9px] text-gray-500">Estimated 1-2 business days</p>
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

// ─── Sub-components ──────────────────────────────────────────────────────────

function AnimatedLoadingStep({ label, delay = 0 }: { label: string; delay?: number }) {
  const [active, setActive] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setActive(true), delay * 1000);
    const t2 = setTimeout(() => setDone(true), (delay + 1.5) * 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [delay]);

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: active ? 1 : 0.3, x: active ? 0 : -8 }}
      transition={{ duration: 0.3 }}
      className="flex items-center gap-2.5"
    >
      {done ? (
        <CheckCircle className="w-4 h-4 text-[#C7FF00] flex-shrink-0" />
      ) : active ? (
        <Loader2 className="w-4 h-4 text-[#C7FF00] animate-spin flex-shrink-0" />
      ) : (
        <div className="w-4 h-4 rounded-full border border-white/15 flex-shrink-0" />
      )}
      <span className={`text-[11px] font-medium ${
        done ? 'text-[#C7FF00]' : active ? 'text-white' : 'text-gray-700'
      }`}>
        {label}
      </span>
    </motion.div>
  );
}
