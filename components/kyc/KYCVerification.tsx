/**
 * BorderPay Africa — KYC Verification Screen
 *
 * Multi-step KYC flow:
 *   1. Country Selector — pick country from supported list
 *   2. ID Type Selector — pick ID type for selected country
 *   3. Details Form — collect all data for Youverify + Maplerad enroll
 *   4. Youverify Liveness — launch Youverify SDK liveness check
 *   5. Under Review — poll status, manual check button
 *   6. Result — approved (account activated) or rejected (retry)
 *
 * Data is saved to kyc_submissions in Supabase BEFORE launching Youverify.
 * After Youverify approves, the youverify-callback Edge Function triggers
 * enroll-maplerad-customer to create a fully enrolled Maplerad customer.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BASE_URL, ANON_KEY, storeUserProfile, readUserProfile, dataCache } from '../../utils/supabase/client';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck, ArrowLeft, FileText, AlertCircle,
  CheckCircle, Loader2, RefreshCw, Fingerprint,
  Lock, Eye, ChevronRight, Wifi, CreditCard, Globe,
  UserCheck, Scan, Shield, Star,
  ArrowRight, Zap, BadgeCheck, Clock, MapPin,
  Search, X, ChevronDown, Calendar, Phone, Mail,
  User, Home, Building, Hash, Briefcase
} from 'lucide-react';
import { toast } from 'sonner';
import { authAPI } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';
import { KYC_COUNTRIES, type KYCCountry, type KYCIdType } from '../../src/lib/kycCountries';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KYCVerificationProps {
  userId: string;
  userEmail: string;
  onBack: () => void;
  onComplete: () => void;
}

type KYCStep = 'welcome' | 'country' | 'id-type' | 'details' | 'liveness' | 'under-review' | 'success' | 'failed';

interface KYCFormData {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  country: string;
  phoneCode: string;
  phoneNumber: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  idType: string;
  idNumber: string;
  usResidencyStatus: string;
  employmentStatus: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const YOUVERIFY_CALLBACK_URL = 'https://app.borderpayafrica.com/youverify-callback';

const UNLOCK_FEATURES = [
  { icon: Globe,      label: 'USD Account',      color: 'from-blue-500/10 to-blue-600/5' },
  { icon: CreditCard, label: 'Virtual Cards',     color: 'from-purple-500/10 to-purple-600/5' },
  { icon: Wifi,       label: 'SWIFT Transfers',   color: 'from-green-500/10 to-green-600/5' },
  { icon: Star,       label: 'Higher Limits',     color: 'from-amber-500/10 to-amber-600/5' },
];

const EMPLOYMENT_OPTIONS = [
  { value: 'employed', label: 'Employed' },
  { value: 'self-employed', label: 'Self-Employed' },
  { value: 'student', label: 'Student' },
  { value: 'unemployed', label: 'Unemployed' },
  { value: 'retired', label: 'Retired' },
];

// ─── Main Component ──────────────────────────────────────────────────────────

export function KYCVerification({ userId, userEmail, onBack, onComplete }: KYCVerificationProps) {
  const [step, setStep] = useState<KYCStep>('welcome');
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  // Country & ID selection
  const [selectedCountry, setSelectedCountry] = useState<KYCCountry | null>(null);
  const [selectedIdType, setSelectedIdType] = useState<KYCIdType | null>(null);
  const [countrySearch, setCountrySearch] = useState('');

  // Form data
  const [formData, setFormData] = useState<KYCFormData>({
    firstName: '',
    lastName: '',
    email: userEmail,
    dateOfBirth: '',
    country: '',
    phoneCode: '',
    phoneNumber: '',
    street: '',
    city: '',
    state: '',
    postalCode: '',
    idType: '',
    idNumber: '',
    usResidencyStatus: 'non-resident alien',
    employmentStatus: 'self-employed',
  });

  const updateForm = (updates: Partial<KYCFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  // Pre-fill name from stored profile
  useEffect(() => {
    const stored = readUserProfile();
    if (stored?.full_name) {
      const parts = stored.full_name.split(' ');
      updateForm({
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ') || '',
      });
    }
  }, []);

  // Check existing KYC status on mount
  useEffect(() => {
    checkExistingStatus();
    return () => stopPolling();
  }, []);

  const checkExistingStatus = async () => {
    try {
      const token = authAPI.getToken();
      if (!token) return;
      const response = await fetch(`${BASE_URL}/youverify-kyc-status`, {
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
      const response = await fetch(`${BASE_URL}/youverify-kyc-status`, {
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

  // ─── Submit KYC data and launch Youverify ─────────────────────────────────

  const submitKYCData = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const token = authAPI.getToken();
      if (!token) throw new Error('Not authenticated');

      // Save KYC submission data to Supabase
      const response = await fetch(`${BASE_URL}/youverify-kyc-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to save KYC data');
      }

      // Transition to liveness step
      setStep('liveness');
    } catch (err: any) {
      setError(err.message || 'Failed to submit data');
      toast.error('Failed to submit KYC data');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Youverify Liveness SDK launch ────────────────────────────────────────

  const launchYouverifyLiveness = async () => {
    try {
      // Youverify SDK is loaded dynamically
      const YouverifySDK = (window as any).YouverifySDK;

      if (YouverifySDK) {
        const livenessModule = new YouverifySDK.liveness({
          publicMerchantKey: (import.meta as any).env.VITE_YOUVERIFY_PUBLIC_KEY || '',
          personalInformation: {
            firstName: formData.firstName,
            lastName: formData.lastName,
          },
          metadata: {
            userId: userId,
            country: formData.country,
            idType: formData.idType,
          },
          onSuccess: async () => {
            setStep('under-review');
            startPolling();
            toast.success('Verification submitted! Under review.');
          },
          onFailure: () => {
            setError('Liveness check failed. Please try again.');
            toast.error('Liveness check failed');
          },
        });

        await livenessModule.initialize();
        livenessModule.start();
      } else {
        // SDK not loaded — fallback: just move to under-review
        // The webhook will still process the result
        console.warn('[KYC] Youverify SDK not loaded — proceeding to under-review');
        setStep('under-review');
        startPolling();
        toast.info('Verification submitted. We\'ll notify you when complete.');
      }
    } catch (err) {
      console.error('[KYC] Youverify SDK error:', err);
      // Fallback: move to under-review anyway
      setStep('under-review');
      startPolling();
    }
  };

  // Auto-launch Youverify when entering liveness step
  useEffect(() => {
    if (step === 'liveness') {
      launchYouverifyLiveness();
    }
  }, [step]);

  const handleRetry = () => {
    stopPolling();
    setStep('country');
    setError(null);
    setSelectedCountry(null);
    setSelectedIdType(null);
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

  // Filter countries for search
  const filteredCountries = countrySearch
    ? KYC_COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
        c.code.toLowerCase().includes(countrySearch.toLowerCase())
      )
    : KYC_COUNTRIES;

  const supportedCountries = filteredCountries.filter(c => c.status === 'supported');
  const comingSoonCountries = filteredCountries.filter(c => c.status === 'coming_soon');

  // Form validation
  const isDetailsFormValid = formData.firstName && formData.lastName && formData.email &&
    formData.dateOfBirth && formData.phoneNumber && formData.street && formData.city &&
    formData.state && formData.idNumber;

  // Step progress
  const stepProgress: Record<KYCStep, number> = {
    welcome: 0, country: 15, 'id-type': 30, details: 50,
    liveness: 70, 'under-review': 85, success: 100, failed: 70,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-full bg-[#0B0E11] text-white flex flex-col pb-safe">
      {/* ── Header ── */}
      {step !== 'liveness' && (
        <div className="sticky top-0 z-30 bg-[#0B0E11]/95 backdrop-blur-xl border-b border-white/[0.06]">
          <div className="flex items-center justify-between px-4 py-3 pt-safe">
            <button
              onClick={step === 'welcome' ? onBack : () => {
                if (step === 'country') setStep('welcome');
                else if (step === 'id-type') setStep('country');
                else if (step === 'details') setStep('id-type');
                else onBack;
              }}
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
              {step === 'under-review' && (
                <div className="w-2 h-2 rounded-full bg-[#C7FF00] animate-pulse" />
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-[2px] bg-white/[0.04]">
            <motion.div
              className="h-full bg-gradient-to-r from-[#C7FF00] to-[#9BDB00]"
              animate={{ width: `${stepProgress[step]}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
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
                  Complete KYC verification to unlock all BorderPay features. Quick, secure, and verified by Youverify.
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

              <div className="mb-5">
                <div className="flex items-center gap-2 mb-3">
                  <Eye className="w-3.5 h-3.5 text-[#C7FF00]" />
                  <span className="text-[10px] font-bold text-[#C7FF00] uppercase tracking-widest">How It Works</span>
                </div>
                <div className="space-y-2">
                  {[
                    { num: '1', text: 'Select your country and ID type' },
                    { num: '2', text: 'Fill in your personal details' },
                    { num: '3', text: 'Complete a quick liveness check' },
                    { num: '4', text: 'Get verified — usually within minutes' },
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

              <div className="flex items-start gap-2.5 bg-white/[0.02] border border-white/[0.06] rounded-xl px-3.5 py-3 mb-4">
                <Lock className="w-3.5 h-3.5 text-[#C7FF00]/60 flex-shrink-0 mt-0.5" />
                <p className="text-[9px] text-[#C7FF00]/50 leading-relaxed">
                  End-to-end encrypted. Biometric data is processed by Youverify and never stored on BorderPay servers.
                </p>
              </div>

              <div className="px-0 pt-2 pb-6">
                <motion.button
                  onClick={() => setStep('country')}
                  className="w-full relative overflow-hidden bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-extrabold text-sm tracking-wide flex items-center justify-center gap-2.5"
                  whileTap={{ scale: 0.97 }}
                >
                  <ShieldCheck size={18} className="relative z-10" />
                  <span className="relative z-10">Start Verification</span>
                  <ArrowRight size={16} className="relative z-10" />
                </motion.button>
                <button onClick={onBack} className="w-full text-gray-600 py-3 text-[10px] font-medium hover:text-gray-400 transition-colors">
                  I'll verify later
                </button>
              </div>
            </motion.div>
          )}

          {/* ═══ COUNTRY SELECTOR ═══ */}
          {step === 'country' && (
            <motion.div
              key="country"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="flex-1 px-5 py-4"
            >
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Globe className="w-7 h-7 text-[#C7FF00]" />
                </div>
                <h2 className="text-lg font-bold">Select Your Country</h2>
                <p className="text-xs text-gray-500 mt-1">Choose the country where your ID was issued</p>
              </div>

              {/* Search */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search countries..."
                  value={countrySearch}
                  onChange={(e) => setCountrySearch(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#C7FF00]/30"
                />
                {countrySearch && (
                  <button onClick={() => setCountrySearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                )}
              </div>

              {/* Country list */}
              <div className="space-y-1.5 max-h-[55vh] overflow-y-auto pr-1">
                {supportedCountries.map((country) => (
                  <button
                    key={country.code}
                    onClick={() => {
                      setSelectedCountry(country);
                      updateForm({ country: country.code, phoneCode: country.dialCode });
                      setStep('id-type');
                    }}
                    className="w-full flex items-center gap-3 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-xl px-4 py-3 transition-all active:scale-[0.98]"
                  >
                    <span className="text-xl">{country.flag}</span>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-semibold text-white">{country.name}</p>
                      <p className="text-[10px] text-gray-500">{country.idTypes.length} ID type{country.idTypes.length !== 1 ? 's' : ''} available</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-600" />
                  </button>
                ))}

                {comingSoonCountries.length > 0 && (
                  <>
                    <div className="pt-3 pb-1">
                      <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Coming Soon</span>
                    </div>
                    {comingSoonCountries.map((country) => (
                      <div
                        key={country.code}
                        className="w-full flex items-center gap-3 bg-white/[0.02] border border-white/[0.04] rounded-xl px-4 py-3 opacity-50 cursor-not-allowed"
                      >
                        <span className="text-xl grayscale">{country.flag}</span>
                        <div className="flex-1 text-left">
                          <p className="text-sm font-medium text-gray-500">{country.name}</p>
                        </div>
                        <span className="text-[9px] font-bold text-gray-600 bg-gray-800 px-2 py-0.5 rounded-full">SOON</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </motion.div>
          )}

          {/* ═══ ID TYPE SELECTOR ═══ */}
          {step === 'id-type' && selectedCountry && (
            <motion.div
              key="id-type"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="flex-1 px-5 py-4"
            >
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <FileText className="w-7 h-7 text-[#C7FF00]" />
                </div>
                <h2 className="text-lg font-bold">Select ID Type</h2>
                <p className="text-xs text-gray-500 mt-1">
                  {selectedCountry.flag} {selectedCountry.name} — choose your government-issued ID
                </p>
              </div>

              <div className="space-y-2">
                {selectedCountry.idTypes.map((idType) => (
                  <button
                    key={idType.id}
                    onClick={() => {
                      setSelectedIdType(idType);
                      updateForm({ idType: idType.id });
                      setStep('details');
                    }}
                    className="w-full flex items-center gap-3 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-xl px-4 py-4 transition-all active:scale-[0.98]"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#C7FF00]/10 flex items-center justify-center flex-shrink-0">
                      <CreditCard className="w-5 h-5 text-[#C7FF00]" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-semibold text-white">{idType.label}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{idType.description}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-600" />
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* ═══ DETAILS FORM ═══ */}
          {step === 'details' && selectedCountry && selectedIdType && (
            <motion.div
              key="details"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="flex-1 px-5 py-4"
            >
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <User className="w-7 h-7 text-[#C7FF00]" />
                </div>
                <h2 className="text-lg font-bold">Your Details</h2>
                <p className="text-xs text-gray-500 mt-1">
                  {selectedCountry.flag} {selectedIdType.label}
                </p>
              </div>

              <div className="space-y-3 pb-6">
                {/* Personal Info */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    icon={User}
                    label="First Name"
                    value={formData.firstName}
                    onChange={(v) => updateForm({ firstName: v })}
                    placeholder="John"
                  />
                  <FormField
                    icon={User}
                    label="Last Name"
                    value={formData.lastName}
                    onChange={(v) => updateForm({ lastName: v })}
                    placeholder="Doe"
                  />
                </div>

                <FormField
                  icon={Mail}
                  label="Email"
                  value={formData.email}
                  onChange={(v) => updateForm({ email: v })}
                  placeholder="you@example.com"
                  type="email"
                />

                <FormField
                  icon={Calendar}
                  label="Date of Birth (DD-MM-YYYY)"
                  value={formData.dateOfBirth}
                  onChange={(v) => updateForm({ dateOfBirth: v })}
                  placeholder="20-10-1990"
                />

                {/* Phone */}
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Phone Number</label>
                  <div className="flex gap-2">
                    <div className="w-20 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-gray-400 flex items-center">
                      {formData.phoneCode || selectedCountry.dialCode}
                    </div>
                    <input
                      type="tel"
                      value={formData.phoneNumber}
                      onChange={(e) => updateForm({ phoneNumber: e.target.value })}
                      placeholder="8000000000"
                      className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#C7FF00]/30"
                    />
                  </div>
                </div>

                {/* ID Number */}
                <FormField
                  icon={Hash}
                  label={`${selectedIdType.label} Number`}
                  value={formData.idNumber}
                  onChange={(v) => updateForm({ idNumber: v })}
                  placeholder="Enter your ID number"
                />

                {/* Address */}
                <div className="pt-2">
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin className="w-3.5 h-3.5 text-[#C7FF00]" />
                    <span className="text-[10px] font-bold text-[#C7FF00] uppercase tracking-widest">Address</span>
                  </div>

                  <div className="space-y-3">
                    <FormField
                      icon={Home}
                      label="Street Address"
                      value={formData.street}
                      onChange={(v) => updateForm({ street: v })}
                      placeholder="123 Main Street"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        icon={Building}
                        label="City"
                        value={formData.city}
                        onChange={(v) => updateForm({ city: v })}
                        placeholder="Lagos"
                      />
                      <FormField
                        icon={MapPin}
                        label="State"
                        value={formData.state}
                        onChange={(v) => updateForm({ state: v })}
                        placeholder="Lagos"
                      />
                    </div>
                    <FormField
                      icon={Hash}
                      label="Postal Code"
                      value={formData.postalCode}
                      onChange={(v) => updateForm({ postalCode: v })}
                      placeholder="100001"
                    />
                  </div>
                </div>

                {/* Employment */}
                <div className="pt-2">
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Employment Status</label>
                  <div className="grid grid-cols-2 gap-2">
                    {EMPLOYMENT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => updateForm({ employmentStatus: opt.value })}
                        className={`px-3 py-2.5 rounded-xl text-xs font-medium border transition-all ${
                          formData.employmentStatus === opt.value
                            ? 'bg-[#C7FF00]/10 border-[#C7FF00]/30 text-[#C7FF00]'
                            : 'bg-white/[0.03] border-white/[0.06] text-gray-400 hover:bg-white/[0.06]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <p className="text-[10px] text-red-400">{error}</p>
                  </div>
                )}

                <motion.button
                  onClick={submitKYCData}
                  disabled={!isDetailsFormValid || isSubmitting}
                  className="w-full bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed mt-4"
                  whileTap={{ scale: 0.97 }}
                >
                  {isSubmitting
                    ? <><Loader2 size={16} className="animate-spin" /> Submitting...</>
                    : <><Scan size={16} /> Continue to Verification</>
                  }
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ═══ LIVENESS (Youverify SDK loads here) ═══ */}
          {step === 'liveness' && (
            <motion.div
              key="liveness"
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
              <h3 className="text-sm font-bold mb-1.5">Launching Liveness Check</h3>
              <p className="text-[10px] text-gray-600 mb-5">Connecting to Youverify...</p>
              <p className="text-[9px] text-gray-700 text-center max-w-[260px]">
                Follow the on-screen instructions to complete your facial verification. This only takes a few seconds.
              </p>
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
                Your identity verification has been submitted successfully. We're reviewing your documents.
              </p>

              <div className="w-full max-w-[320px] bg-gradient-to-br from-yellow-500/[0.08] to-orange-500/[0.04] border border-yellow-500/20 rounded-2xl p-5 mb-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-yellow-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">Estimated Completion</p>
                    <p className="text-xs text-yellow-400 font-semibold">Usually within a few minutes to 24 hours</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-black/20 rounded-xl px-4 py-3">
                  <CheckCircle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                  <p className="text-[11px] text-gray-300">
                    Expected by <span className="text-yellow-400 font-bold">{getDeadline()}</span>
                  </p>
                </div>
              </div>

              <div className="w-full max-w-[320px] bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 mb-5">
                <p className="text-[10px] font-bold text-[#C7FF00] uppercase tracking-widest mb-3">What happens next</p>
                <div className="space-y-3">
                  {[
                    { icon: Eye, text: 'Youverify reviews your ID and liveness check' },
                    { icon: ShieldCheck, text: 'Document authenticity is verified' },
                    { icon: UserCheck, text: 'Your Maplerad account is created automatically' },
                    { icon: BadgeCheck, text: 'All premium features unlock immediately' },
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
                  className="text-2xl font-black text-white mb-2">Account Activated!</motion.h2>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
                  className="text-xs text-gray-400 max-w-[260px] mb-6">
                  Your identity has been verified and your account is fully activated. All features are now unlocked.
                </motion.p>
                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.9 }}
                  className="inline-flex items-center gap-2.5 px-5 py-3 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-2xl mb-6">
                  <ShieldCheck className="w-4 h-4 text-[#C7FF00]" />
                  <span className="text-xs text-[#C7FF00] font-bold">Fully Verified — All Features Unlocked</span>
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
                Make sure your ID is valid, well-lit, and your selfie is clear. Then try again with a different ID if needed.
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

// ─── Reusable Form Field Component ──────────────────────────────────────────

function FormField({
  icon: Icon,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  icon: React.ComponentType<any>;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl pl-10 pr-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#C7FF00]/30"
        />
      </div>
    </div>
  );
}
