/**
 * BorderPay Africa — KYC Verification Screen
 *
 * 6-step KYC flow backed entirely by the Maplerad edge functions
 * (kyc-submit + kyc-status). Documents are uploaded directly to the
 * private Supabase Storage bucket `kyc-documents` under the caller's
 * user_id prefix, and only the storage paths are sent to the backend.
 *
 *   Step 1 — Personal info (name, email, DOB, phone)
 *   Step 2 — Home address
 *   Step 3 — Identity document (country + ID type + number + front/back)
 *   Step 4 — Selfie (live camera capture with manual upload fallback)
 *   Step 5 — Proof of address upload
 *   Step 6 — Review & submit  → kyc-submit → poll kyc-status every 30s
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BASE_URL, ANON_KEY, supabase, storeUserProfile, readUserProfile, dataCache } from '../../utils/supabase/client';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck, ArrowLeft, FileText, AlertCircle,
  CheckCircle, Loader2, RefreshCw, Fingerprint,
  Lock, Eye, ChevronRight, Wifi, CreditCard, Globe,
  UserCheck, Scan, Shield, Star,
  ArrowRight, Zap, BadgeCheck, Clock, MapPin,
  Search, X, ChevronDown, Calendar, Phone, Mail,
  User, Home, Building, Hash, Upload, Camera, Image as ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { authAPI } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';
import { COUNTRY_CONFIG, getActiveCountries, getCountryByCode, type CountryConfig, type IDType } from '../../src/lib/countries';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KYCVerificationProps {
  userId: string;
  userEmail: string;
  onBack: () => void;
  onComplete: () => void;
}

type KYCStep =
  | 'welcome'
  | 'personal'
  | 'address'
  | 'identity'
  | 'selfie'
  | 'poa'
  | 'review'
  | 'under-review'
  | 'success'
  | 'failed';

interface KYCFormData {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  phoneCode: string;
  phoneNumber: string;
  country: string;
  street: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  idType: string;
  idNumber: string;
  mapleradIdentityType: string;
  poaDocumentType: 'utility_bill' | 'bank_statement' | 'lease' | 'tax_document' | '';
}

interface UploadState {
  idFrontPath: string | null;
  idBackPath: string | null;
  selfiePath: string | null;
  poaPath: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const KYC_BUCKET = 'kyc-documents';

const UNLOCK_FEATURES = [
  { icon: Globe,      label: 'USD Account',    color: 'from-blue-500/10 to-blue-600/5' },
  { icon: CreditCard, label: 'Virtual Cards',  color: 'from-purple-500/10 to-purple-600/5' },
  { icon: Wifi,       label: 'SWIFT Transfers', color: 'from-green-500/10 to-green-600/5' },
  { icon: Star,       label: 'Higher Limits',  color: 'from-amber-500/10 to-amber-600/5' },
];

const POA_TYPES: { value: KYCFormData['poaDocumentType']; label: string; hint: string }[] = [
  { value: 'utility_bill',  label: 'Utility Bill',    hint: 'Electricity, water, or internet — within last 3 months' },
  { value: 'bank_statement', label: 'Bank Statement',  hint: 'Dated within the last 3 months' },
  { value: 'lease',          label: 'Lease Agreement', hint: 'Current residential lease' },
  { value: 'tax_document',   label: 'Tax Document',    hint: 'Issued within the last 12 months' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extFor(file: File): string {
  const fromName = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  if (fromName) return fromName;
  if (file.type === 'image/png')  return 'png';
  if (file.type === 'image/jpeg') return 'jpg';
  if (file.type === 'application/pdf') return 'pdf';
  return 'bin';
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function KYCVerification({ userId, userEmail, onBack, onComplete }: KYCVerificationProps) {
  const [step, setStep] = useState<KYCStep>('welcome');
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  // Country & ID selection
  const [selectedCountry, setSelectedCountry] = useState<CountryConfig | null>(null);
  const [selectedIdType, setSelectedIdType] = useState<IDType | null>(null);
  const [countrySearch, setCountrySearch] = useState('');
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);

  // Form data
  const [formData, setFormData] = useState<KYCFormData>({
    firstName: '',
    lastName: '',
    email: userEmail,
    dateOfBirth: '',
    phoneCode: '',
    phoneNumber: '',
    country: '',
    street: '',
    street2: '',
    city: '',
    state: '',
    postalCode: '',
    idType: '',
    idNumber: '',
    mapleradIdentityType: '',
    poaDocumentType: '',
  });

  const [uploads, setUploads] = useState<UploadState>({
    idFrontPath: null,
    idBackPath: null,
    selfiePath: null,
    poaPath: null,
  });

  const updateForm = (updates: Partial<KYCFormData>) =>
    setFormData(prev => ({ ...prev, ...updates }));

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

  // Check existing status on mount
  useEffect(() => {
    checkExistingStatus();
    return () => stopPolling();
  }, []);

  // ─── Status polling ──────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    pollCountRef.current = 0;
  }, []);

  const checkExistingStatus = async () => {
    try {
      const result = await backendAPI.kyc.getKYCStatus();
      if (!result.success) return;
      const status = (result as any).status;
      if (status === 'approved') {
        setStep('success');
      } else if (status === 'under_review') {
        setStep('under-review');
        startPolling();
      } else if (status === 'rejected') {
        const reason = (result as any).rejection_reason;
        if (reason) setError(reason);
        setStep('failed');
      }
    } catch { /* stay on welcome */ }
  };

  const checkVerificationStatus = useCallback(async (manual = false) => {
    pollCountRef.current += 1;
    if (!manual && pollCountRef.current > 120) {
      stopPolling();
      return;
    }
    try {
      const result = await backendAPI.kyc.getKYCStatus();
      if (!result.success) return;
      const status = (result as any).status;
      if (status === 'approved') {
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
      } else if (status === 'rejected') {
        stopPolling();
        const reason = (result as any).rejection_reason;
        setError(reason || 'Verification could not be completed. Please try again.');
        setStep('failed');
        toast.error('Verification failed');
      }
    } catch { /* polling retries */ }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollCountRef.current = 0;
    pollingRef.current = setInterval(() => checkVerificationStatus(false), 30000);
  }, [checkVerificationStatus]);

  // ─── Uploads to kyc-documents bucket ─────────────────────────────────────

  const uploadFile = async (file: File, slot: 'id-front' | 'id-back' | 'selfie' | 'poa'): Promise<string | null> => {
    setError(null);
    setIsUploading(true);
    try {
      const path = `${userId}/${slot}-${Date.now()}.${extFor(file)}`;
      const { error: upErr } = await supabase.storage
        .from(KYC_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (upErr) throw upErr;
      return path;
    } catch (err: any) {
      console.error('[KYC] Upload failed:', err?.message);
      setError(err?.message || 'Upload failed. Please try again.');
      toast.error('Upload failed');
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>, slot: 'id-front' | 'id-back' | 'selfie' | 'poa') => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    // Size / type guards
    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) { toast.error('File too large (max 10MB)'); return; }

    const isPoa = slot === 'poa';
    const acceptable = isPoa
      ? ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
      : ['image/jpeg', 'image/png', 'image/webp'];
    if (!acceptable.includes(file.type)) {
      toast.error(isPoa ? 'Use JPG, PNG, WEBP or PDF' : 'Use JPG, PNG or WEBP');
      return;
    }

    const path = await uploadFile(file, slot);
    if (!path) return;

    if (slot === 'id-front') setUploads(u => ({ ...u, idFrontPath: path }));
    else if (slot === 'id-back') setUploads(u => ({ ...u, idBackPath: path }));
    else if (slot === 'selfie') setUploads(u => ({ ...u, selfiePath: path }));
    else if (slot === 'poa') setUploads(u => ({ ...u, poaPath: path }));
  };

  // ─── Camera (selfie) ─────────────────────────────────────────────────────

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraOn(true);
    } catch (err: any) {
      setError('Camera unavailable. You can upload a selfie instead.');
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  useEffect(() => () => stopCamera(), []);

  const captureSelfie = async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    const canvas = document.createElement('canvas');
    const size = Math.min(video.videoWidth, video.videoHeight) || 720;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) { toast.error('Capture failed'); return; }
    const file = new File([blob], `selfie.jpg`, { type: 'image/jpeg' });
    stopCamera();
    const path = await uploadFile(file, 'selfie');
    if (path) setUploads(u => ({ ...u, selfiePath: path }));
  };

  // ─── Final submission ────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!uploads.idFrontPath || !uploads.selfiePath) {
      toast.error('Missing required documents');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const payload = {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        email: formData.email.trim(),
        dateOfBirth: formData.dateOfBirth.trim(),
        phoneCode: formData.phoneCode,
        phoneNumber: formData.phoneNumber.trim(),
        country: formData.country,
        street: formData.street.trim(),
        street2: formData.street2.trim() || undefined,
        city: formData.city.trim(),
        state: formData.state.trim(),
        postalCode: formData.postalCode.trim() || undefined,
        idType: formData.idType,
        idNumber: formData.idNumber.trim(),
        mapleradIdentityType: formData.mapleradIdentityType,
        idFrontPath: uploads.idFrontPath!,
        idBackPath: uploads.idBackPath || null,
        selfiePath: uploads.selfiePath!,
        poaPath: uploads.poaPath || null,
        poaDocumentType: formData.poaDocumentType || null,
      };

      const result = await backendAPI.kyc.submit(payload);
      const body = result as any;

      if (!body.success) {
        setError(body.error || 'Submission failed. Please try again.');
        toast.error('Submission failed');
        setStep('failed');
        return;
      }

      if (body.status === 'approved') {
        setStep('success');
        toast.success('Identity verified!');
        try {
          const profileResult = await backendAPI.user.getProfile();
          if (profileResult.success && profileResult.data?.user) {
            storeUserProfile(profileResult.data.user);
            dataCache.invalidate('profile');
          }
        } catch { /* silent */ }
        return;
      }

      // Under review — kick off polling
      setStep('under-review');
      startPolling();
      toast.success('Submitted for review');
    } catch (err: any) {
      setError(err?.message || 'Submission failed');
      toast.error('Submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetry = () => {
    stopPolling();
    setError(null);
    setUploads({ idFrontPath: null, idBackPath: null, selfiePath: null, poaPath: null });
    setStep('personal');
  };

  // ─── Derived state / validation ──────────────────────────────────────────

  const personalValid =
    formData.firstName.trim().length >= 2 &&
    formData.lastName.trim().length >= 2 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(formData.email) &&
    /^\d{2}-\d{2}-\d{4}$/.test(formData.dateOfBirth) &&
    formData.phoneNumber.trim().length >= 6;

  const addressValid =
    !!selectedCountry &&
    formData.street.trim().length >= 2 &&
    formData.city.trim().length >= 2 &&
    formData.state.trim().length >= 2;

  const identityValid =
    !!selectedIdType &&
    formData.idNumber.trim().length >= 3 &&
    !!uploads.idFrontPath;

  const selfieValid = !!uploads.selfiePath;
  const poaValid = !!uploads.poaPath && !!formData.poaDocumentType;

  const stepProgress: Record<KYCStep, number> = {
    welcome: 0,
    personal: 15,
    address: 30,
    identity: 50,
    selfie: 65,
    poa: 80,
    review: 92,
    'under-review': 95,
    success: 100,
    failed: 50,
  };

  const stepIndex = (() => {
    const order: KYCStep[] = ['personal', 'address', 'identity', 'selfie', 'poa', 'review'];
    return order.indexOf(step) + 1;
  })();

  const goBackFromStep = () => {
    if (step === 'welcome') onBack();
    else if (step === 'personal') setStep('welcome');
    else if (step === 'address') setStep('personal');
    else if (step === 'identity') setStep('address');
    else if (step === 'selfie') setStep('identity');
    else if (step === 'poa') setStep('selfie');
    else if (step === 'review') setStep('poa');
    else onBack();
  };

  // Coming-soon filter
  const filteredCountries = countrySearch
    ? COUNTRY_CONFIG.filter(c =>
        c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
        c.code.toLowerCase().includes(countrySearch.toLowerCase()))
    : COUNTRY_CONFIG;
  const supportedCountries = filteredCountries.filter(c => c.status === 'active');

  // Filter ID types for country. Rule: BVN visible only for Nigeria (config
  // already restricts this, but enforce defensively). Passport is always shown
  // when present in the country's idTypes.
  const allowedIdTypes: IDType[] = selectedCountry
    ? selectedCountry.idTypes.filter(t => t.code !== 'BVN' || selectedCountry.code === 'NG')
    : [];

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-full bg-[#0B0E11] text-white flex flex-col pb-safe">
      {/* ── Header ── */}
      <div className="sticky top-0 z-30 bg-[#0B0E11]/95 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="flex items-center justify-between px-4 py-3 pt-safe">
          <button
            onClick={goBackFromStep}
            className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center hover:bg-white/10 transition-all active:scale-90"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-[#C7FF00]" />
            <span className="text-[11px] font-bold tracking-widest uppercase">
              {stepIndex > 0 ? `Step ${stepIndex} of 6` : 'Identity Verification'}
            </span>
          </div>
          <div className="w-9 flex items-center justify-center">
            {step === 'under-review' && <div className="w-2 h-2 rounded-full bg-[#C7FF00] animate-pulse" />}
          </div>
        </div>

        <div className="h-[2px] bg-white/[0.04]">
          <motion.div
            className="h-full bg-gradient-to-r from-[#C7FF00] to-[#9BDB00]"
            animate={{ width: `${stepProgress[step]}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        <AnimatePresence mode="wait">

          {/* ═══ WELCOME ═══ */}
          {step === 'welcome' && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
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
                  Complete KYC verification to unlock all BorderPay features. Secured by BorderPay Africa.
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
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
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
                    { num: '1', text: 'Tell us about yourself' },
                    { num: '2', text: 'Add your home address' },
                    { num: '3', text: 'Upload your ID document' },
                    { num: '4', text: 'Take a quick selfie' },
                    { num: '5', text: 'Upload proof of address' },
                    { num: '6', text: 'Review and submit' },
                  ].map((s, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.06 }}
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
                  End-to-end encrypted. Your documents are stored securely and used only for identity verification.
                </p>
              </div>

              <div className="px-0 pt-2 pb-6">
                <motion.button
                  onClick={() => setStep('personal')}
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

          {/* ═══ STEP 1 — PERSONAL ═══ */}
          {step === 'personal' && (
            <motion.div
              key="personal"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
              className="flex-1 px-5 py-4"
            >
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <User className="w-7 h-7 text-[#C7FF00]" />
                </div>
                <h2 className="text-lg font-bold">Personal Info</h2>
                <p className="text-xs text-gray-500 mt-1">Tell us a bit about yourself</p>
              </div>

              <div className="space-y-3 pb-6">
                <div className="grid grid-cols-2 gap-3">
                  <FormField icon={User} label="First Name" value={formData.firstName}
                    onChange={(v) => updateForm({ firstName: v })} placeholder="John" />
                  <FormField icon={User} label="Last Name" value={formData.lastName}
                    onChange={(v) => updateForm({ lastName: v })} placeholder="Doe" />
                </div>
                <FormField icon={Mail} label="Email" value={formData.email}
                  onChange={(v) => updateForm({ email: v })} placeholder="you@example.com" type="email" />
                <FormField icon={Calendar} label="Date of Birth (DD-MM-YYYY)" value={formData.dateOfBirth}
                  onChange={(v) => updateForm({ dateOfBirth: v })} placeholder="20-10-1990" />

                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Phone Number</label>
                  <div className="flex gap-2">
                    <input
                      value={formData.phoneCode}
                      onChange={(e) => updateForm({ phoneCode: e.target.value })}
                      placeholder="+234"
                      className="w-24 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#C7FF00]/30"
                    />
                    <input
                      type="tel"
                      value={formData.phoneNumber}
                      onChange={(e) => updateForm({ phoneNumber: e.target.value })}
                      placeholder="8000000000"
                      className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#C7FF00]/30"
                    />
                  </div>
                </div>

                {error && <ErrorBanner text={error} />}

                <motion.button
                  onClick={() => setStep('address')}
                  disabled={!personalValid}
                  className="w-full bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed mt-4"
                  whileTap={{ scale: 0.97 }}
                >
                  Continue <ArrowRight size={16} />
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ═══ STEP 2 — ADDRESS ═══ */}
          {step === 'address' && (
            <motion.div
              key="address"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
              className="flex-1 px-5 py-4"
            >
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Home className="w-7 h-7 text-[#C7FF00]" />
                </div>
                <h2 className="text-lg font-bold">Home Address</h2>
                <p className="text-xs text-gray-500 mt-1">Where do you currently live?</p>
              </div>

              <div className="space-y-3 pb-6">
                {/* Country picker */}
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Country</label>
                  <button
                    onClick={() => setCountryPickerOpen(true)}
                    className="w-full flex items-center gap-3 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-left"
                  >
                    {selectedCountry ? (
                      <>
                        <span className="text-xl">{selectedCountry.flag}</span>
                        <span className="flex-1 text-white">{selectedCountry.name}</span>
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      </>
                    ) : (
                      <>
                        <Globe className="w-4 h-4 text-gray-500" />
                        <span className="flex-1 text-gray-500">Select your country</span>
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      </>
                    )}
                  </button>
                </div>

                <FormField icon={Home} label="Street Address" value={formData.street}
                  onChange={(v) => updateForm({ street: v })} placeholder="123 Main Street" />
                <FormField icon={Home} label="Apt / Suite (optional)" value={formData.street2}
                  onChange={(v) => updateForm({ street2: v })} placeholder="Apt 4B" />
                <div className="grid grid-cols-2 gap-3">
                  <FormField icon={Building} label="City" value={formData.city}
                    onChange={(v) => updateForm({ city: v })} placeholder="Lagos" />
                  <FormField icon={MapPin} label="State" value={formData.state}
                    onChange={(v) => updateForm({ state: v })} placeholder="Lagos" />
                </div>
                <FormField icon={Hash} label="Postal Code (optional)" value={formData.postalCode}
                  onChange={(v) => updateForm({ postalCode: v })} placeholder="100001" />

                {error && <ErrorBanner text={error} />}

                <motion.button
                  onClick={() => setStep('identity')}
                  disabled={!addressValid}
                  className="w-full bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed mt-4"
                  whileTap={{ scale: 0.97 }}
                >
                  Continue <ArrowRight size={16} />
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ═══ STEP 3 — IDENTITY DOCUMENT ═══ */}
          {step === 'identity' && (
            <motion.div
              key="identity"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
              className="flex-1 px-5 py-4"
            >
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <FileText className="w-7 h-7 text-[#C7FF00]" />
                </div>
                <h2 className="text-lg font-bold">Identity Document</h2>
                <p className="text-xs text-gray-500 mt-1">Choose your ID type and upload a clear photo</p>
              </div>

              <div className="space-y-3 pb-6">
                {/* ID type selector */}
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">ID Type</label>
                  <div className="grid grid-cols-1 gap-2">
                    {allowedIdTypes.map((t) => (
                      <button
                        key={t.code}
                        onClick={() => {
                          setSelectedIdType(t);
                          updateForm({
                            idType: t.code,
                            mapleradIdentityType: t.mapleradIdentityType,
                          });
                        }}
                        className={`flex items-center gap-3 border rounded-xl px-3.5 py-3 text-left transition-all ${
                          formData.idType === t.code
                            ? 'bg-[#C7FF00]/10 border-[#C7FF00]/30'
                            : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="w-9 h-9 rounded-lg bg-[#C7FF00]/10 flex items-center justify-center flex-shrink-0">
                          <CreditCard className="w-4 h-4 text-[#C7FF00]" />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-white">{t.label}</p>
                          <p className="text-[10px] text-gray-500">{t.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                  {selectedCountry && allowedIdTypes.length === 0 && (
                    <p className="text-[10px] text-gray-500 mt-2">No ID types configured for {selectedCountry.name}.</p>
                  )}
                </div>

                {selectedIdType && (
                  <FormField
                    icon={Hash}
                    label={`${selectedIdType.label} Number`}
                    value={formData.idNumber}
                    onChange={(v) => updateForm({ idNumber: v })}
                    placeholder="Enter your ID number"
                  />
                )}

                {/* ID front */}
                <UploadCard
                  title="ID Front"
                  subtitle="Clear photo of the front of your ID"
                  done={!!uploads.idFrontPath}
                  onClear={() => setUploads(u => ({ ...u, idFrontPath: null }))}
                >
                  <input
                    id="id-front-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => handleFileInput(e, 'id-front')}
                    className="hidden"
                  />
                  <label htmlFor="id-front-input" className="flex items-center justify-center gap-2 text-xs font-semibold text-[#C7FF00] cursor-pointer">
                    <Upload size={14} /> {uploads.idFrontPath ? 'Replace' : 'Upload'}
                  </label>
                </UploadCard>

                {/* ID back (optional for passports) */}
                <UploadCard
                  title="ID Back (optional)"
                  subtitle="Only if the reverse of your ID contains info"
                  done={!!uploads.idBackPath}
                  onClear={() => setUploads(u => ({ ...u, idBackPath: null }))}
                >
                  <input
                    id="id-back-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => handleFileInput(e, 'id-back')}
                    className="hidden"
                  />
                  <label htmlFor="id-back-input" className="flex items-center justify-center gap-2 text-xs font-semibold text-[#C7FF00] cursor-pointer">
                    <Upload size={14} /> {uploads.idBackPath ? 'Replace' : 'Upload'}
                  </label>
                </UploadCard>

                {error && <ErrorBanner text={error} />}

                <motion.button
                  onClick={() => setStep('selfie')}
                  disabled={!identityValid || isUploading}
                  className="w-full bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed mt-4"
                  whileTap={{ scale: 0.97 }}
                >
                  Continue <ArrowRight size={16} />
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ═══ STEP 4 — SELFIE ═══ */}
          {step === 'selfie' && (
            <motion.div
              key="selfie"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
              className="flex-1 px-5 py-4"
            >
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Scan className="w-7 h-7 text-[#C7FF00]" />
                </div>
                <h2 className="text-lg font-bold">Selfie</h2>
                <p className="text-xs text-gray-500 mt-1">Snap a clear photo of your face</p>
              </div>

              <div className="pb-6">
                <div className="bg-black/40 border border-white/[0.08] rounded-2xl overflow-hidden aspect-square flex items-center justify-center relative">
                  {uploads.selfiePath ? (
                    <div className="flex flex-col items-center justify-center text-center px-4">
                      <CheckCircle className="w-10 h-10 text-[#C7FF00] mb-2" />
                      <p className="text-xs font-semibold text-white">Selfie uploaded</p>
                      <p className="text-[10px] text-gray-500 mt-1">You can retake it below</p>
                    </div>
                  ) : cameraOn ? (
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center px-4">
                      <Camera className="w-10 h-10 text-gray-500 mb-2" />
                      <p className="text-xs text-gray-400">Turn on the camera or upload a photo</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mt-3">
                  {cameraOn ? (
                    <>
                      <motion.button
                        onClick={captureSelfie}
                        disabled={isUploading}
                        className="flex-1 bg-[#C7FF00] text-[#0B0E11] py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                        whileTap={{ scale: 0.97 }}
                      >
                        {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                        Capture
                      </motion.button>
                      <button
                        onClick={stopCamera}
                        className="px-4 bg-white/[0.06] border border-white/[0.1] rounded-xl text-xs font-semibold"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <motion.button
                        onClick={startCamera}
                        className="flex-1 bg-[#C7FF00] text-[#0B0E11] py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2"
                        whileTap={{ scale: 0.97 }}
                      >
                        <Camera size={14} /> {uploads.selfiePath ? 'Retake' : 'Open Camera'}
                      </motion.button>
                      <input
                        id="selfie-upload"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => handleFileInput(e, 'selfie')}
                        className="hidden"
                      />
                      <label htmlFor="selfie-upload" className="px-4 bg-white/[0.06] border border-white/[0.1] rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer">
                        <Upload size={14} /> Upload
                      </label>
                    </>
                  )}
                </div>

                <div className="mt-4 bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
                  <p className="text-[10px] font-bold text-[#C7FF00] uppercase tracking-widest mb-2">Tips</p>
                  <ul className="space-y-1.5">
                    {['Use good lighting', 'Face the camera directly', 'Remove glasses if wearing any'].map((t, i) => (
                      <li key={i} className="flex items-center gap-2 text-[10px] text-gray-400">
                        <CheckCircle className="w-3 h-3 text-[#C7FF00]" /> {t}
                      </li>
                    ))}
                  </ul>
                </div>

                {error && <ErrorBanner text={error} />}

                <motion.button
                  onClick={() => setStep('poa')}
                  disabled={!selfieValid || isUploading}
                  className="w-full bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed mt-4"
                  whileTap={{ scale: 0.97 }}
                >
                  Continue <ArrowRight size={16} />
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ═══ STEP 5 — PROOF OF ADDRESS ═══ */}
          {step === 'poa' && (
            <motion.div
              key="poa"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
              className="flex-1 px-5 py-4"
            >
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <ImageIcon className="w-7 h-7 text-[#C7FF00]" />
                </div>
                <h2 className="text-lg font-bold">Proof of Address</h2>
                <p className="text-xs text-gray-500 mt-1">Pick a document type and upload it</p>
              </div>

              <div className="space-y-3 pb-6">
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Document Type</label>
                  <div className="grid grid-cols-1 gap-2">
                    {POA_TYPES.map((t) => (
                      <button
                        key={t.value}
                        onClick={() => updateForm({ poaDocumentType: t.value as KYCFormData['poaDocumentType'] })}
                        className={`flex items-center gap-3 border rounded-xl px-3.5 py-3 text-left transition-all ${
                          formData.poaDocumentType === t.value
                            ? 'bg-[#C7FF00]/10 border-[#C7FF00]/30'
                            : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="w-9 h-9 rounded-lg bg-[#C7FF00]/10 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-4 h-4 text-[#C7FF00]" />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-white">{t.label}</p>
                          <p className="text-[10px] text-gray-500">{t.hint}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <UploadCard
                  title="Upload document"
                  subtitle="JPG, PNG, WEBP or PDF up to 10MB"
                  done={!!uploads.poaPath}
                  onClear={() => setUploads(u => ({ ...u, poaPath: null }))}
                >
                  <input
                    id="poa-upload"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => handleFileInput(e, 'poa')}
                    className="hidden"
                  />
                  <label htmlFor="poa-upload" className="flex items-center justify-center gap-2 text-xs font-semibold text-[#C7FF00] cursor-pointer">
                    <Upload size={14} /> {uploads.poaPath ? 'Replace' : 'Upload'}
                  </label>
                </UploadCard>

                {error && <ErrorBanner text={error} />}

                <motion.button
                  onClick={() => setStep('review')}
                  disabled={!poaValid || isUploading}
                  className="w-full bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed mt-4"
                  whileTap={{ scale: 0.97 }}
                >
                  Continue <ArrowRight size={16} />
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ═══ STEP 6 — REVIEW & SUBMIT ═══ */}
          {step === 'review' && (
            <motion.div
              key="review"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
              className="flex-1 px-5 py-4"
            >
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <BadgeCheck className="w-7 h-7 text-[#C7FF00]" />
                </div>
                <h2 className="text-lg font-bold">Review &amp; Submit</h2>
                <p className="text-xs text-gray-500 mt-1">Confirm everything looks right</p>
              </div>

              <div className="space-y-3 pb-6">
                <ReviewSection title="Personal">
                  <ReviewRow label="Name" value={`${formData.firstName} ${formData.lastName}`} />
                  <ReviewRow label="Email" value={formData.email} />
                  <ReviewRow label="DOB" value={formData.dateOfBirth} />
                  <ReviewRow label="Phone" value={`${formData.phoneCode} ${formData.phoneNumber}`} />
                </ReviewSection>

                <ReviewSection title="Address">
                  <ReviewRow label="Country" value={selectedCountry ? `${selectedCountry.flag} ${selectedCountry.name}` : '—'} />
                  <ReviewRow label="Street" value={[formData.street, formData.street2].filter(Boolean).join(', ')} />
                  <ReviewRow label="City / State" value={`${formData.city}, ${formData.state}`} />
                  {formData.postalCode && <ReviewRow label="Postal" value={formData.postalCode} />}
                </ReviewSection>

                <ReviewSection title="Identity">
                  <ReviewRow label="Type" value={selectedIdType?.label || '—'} />
                  <ReviewRow label="Number" value={formData.idNumber} />
                  <ReviewRow label="ID front" value={uploads.idFrontPath ? 'Uploaded' : 'Missing'} ok={!!uploads.idFrontPath} />
                  {uploads.idBackPath && <ReviewRow label="ID back" value="Uploaded" ok />}
                </ReviewSection>

                <ReviewSection title="Selfie &amp; Proof of Address">
                  <ReviewRow label="Selfie" value={uploads.selfiePath ? 'Uploaded' : 'Missing'} ok={!!uploads.selfiePath} />
                  <ReviewRow label="POA type" value={POA_TYPES.find(p => p.value === formData.poaDocumentType)?.label || '—'} />
                  <ReviewRow label="POA file" value={uploads.poaPath ? 'Uploaded' : 'Missing'} ok={!!uploads.poaPath} />
                </ReviewSection>

                {error && <ErrorBanner text={error} />}

                <motion.button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !uploads.idFrontPath || !uploads.selfiePath}
                  className="w-full bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed mt-4"
                  whileTap={{ scale: 0.97 }}
                >
                  {isSubmitting
                    ? <><Loader2 size={16} className="animate-spin" /> Submitting your verification...</>
                    : <><ShieldCheck size={16} /> Submit Verification</>
                  }
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ═══ UNDER REVIEW ═══ */}
          {step === 'under-review' && (
            <motion.div
              key="under-review"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="flex-1 flex flex-col items-center px-5 py-8"
            >
              <motion.div
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="w-24 h-24 rounded-3xl bg-gradient-to-br from-yellow-500/20 to-orange-500/10 border border-yellow-500/20 flex items-center justify-center mb-5"
              >
                <Clock className="w-12 h-12 text-yellow-400" strokeWidth={1.5} />
              </motion.div>

              <h2 className="text-xl font-black text-white mb-2 text-center">Under Review</h2>
              <p className="text-xs text-gray-400 text-center max-w-[300px] mb-6 leading-relaxed">
                Your submission is being reviewed. We'll update this screen automatically — you can also check manually.
              </p>

              <div className="w-full max-w-[320px] bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 mb-5">
                <p className="text-[10px] font-bold text-[#C7FF00] uppercase tracking-widest mb-3">What happens next</p>
                <div className="space-y-3">
                  {[
                    { icon: Eye, text: 'Our team reviews your ID and documents' },
                    { icon: ShieldCheck, text: 'Identity is verified against issuer records' },
                    { icon: UserCheck, text: 'Your Maplerad account is provisioned' },
                    { icon: BadgeCheck, text: 'All premium features unlock' },
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
                <ArrowRight size={16} /> Back to App
              </motion.button>
            </motion.div>
          )}

          {/* ═══ SUCCESS ═══ */}
          {step === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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
                  initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }}
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
                  <span className="text-xs text-[#C7FF00] font-bold">Secured by BorderPay Africa</span>
                </motion.div>
                <motion.button
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}
                  onClick={onComplete}
                  className="w-full max-w-[280px] bg-[#C7FF00] text-[#0B0E11] py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 mx-auto"
                  whileTap={{ scale: 0.97 }}
                >
                  <ArrowRight size={16} /> Continue
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ═══ FAILED ═══ */}
          {step === 'failed' && (
            <motion.div
              key="failed"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center px-6"
            >
              <motion.div
                initial={{ scale: 0 }} animate={{ scale: 1 }}
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
                  <RefreshCw size={15} /> Try Again
                </motion.button>
                <button onClick={onBack} className="w-full text-gray-500 py-3 text-[10px] font-medium hover:text-gray-300 transition-colors">
                  Go Back
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── Country picker modal ── */}
      <AnimatePresence>
        {countryPickerOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex flex-col"
            onClick={() => setCountryPickerOpen(false)}
          >
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30 }}
              className="mt-auto bg-[#0B0E11] border-t border-white/[0.06] rounded-t-3xl max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-4 pb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold">Select country</h3>
                <button onClick={() => setCountryPickerOpen(false)} className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center">
                  <X size={14} />
                </button>
              </div>
              <div className="px-5 pb-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Search countries..."
                    value={countrySearch}
                    onChange={(e) => setCountrySearch(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl pl-10 pr-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#C7FF00]/30"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-1.5">
                {supportedCountries.map((c) => (
                  <button
                    key={c.code}
                    onClick={() => {
                      setSelectedCountry(c);
                      updateForm({ country: c.code, phoneCode: formData.phoneCode || c.dialCode });
                      setSelectedIdType(null);
                      updateForm({ idType: '', idNumber: '', mapleradIdentityType: '' });
                      setCountryPickerOpen(false);
                    }}
                    className="w-full flex items-center gap-3 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-xl px-4 py-3 transition-all"
                  >
                    <span className="text-xl">{c.flag}</span>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-semibold text-white">{c.name}</p>
                      <p className="text-[10px] text-gray-500">{c.idTypes.length} ID types available</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-600" />
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Reusable bits ──────────────────────────────────────────────────────────

function FormField({
  icon: Icon, label, value, onChange, placeholder, type = 'text',
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

function UploadCard({
  title, subtitle, done, onClear, children,
}: {
  title: string;
  subtitle: string;
  done: boolean;
  onClear: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`border rounded-xl px-4 py-3 ${done ? 'bg-[#C7FF00]/10 border-[#C7FF00]/30' : 'bg-white/[0.03] border-white/[0.06]'}`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-xs font-semibold text-white">{title}</p>
          <p className="text-[10px] text-gray-500">{subtitle}</p>
        </div>
        {done ? (
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-[#C7FF00]" />
            <button onClick={onClear} className="text-[10px] text-gray-500 hover:text-gray-300">Clear</button>
          </div>
        ) : (
          <div className="w-6 h-6 rounded-full border border-white/[0.08]" />
        )}
      </div>
      {children}
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
      <p className="text-[10px] font-bold text-[#C7FF00] uppercase tracking-widest mb-2">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] text-gray-500">{label}</span>
      <span className={`text-[11px] font-semibold text-right ${ok === false ? 'text-red-400' : 'text-white'}`}>
        {value || '—'}
      </span>
    </div>
  );
}

function ErrorBanner({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
      <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
      <p className="text-[10px] text-red-400 leading-relaxed">{text}</p>
    </div>
  );
}
