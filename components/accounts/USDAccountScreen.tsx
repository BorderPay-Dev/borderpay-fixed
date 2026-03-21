/**
 * BorderPay Africa – USD Virtual Account Creation
 * Multi-step wizard following full Banking API spec.
 * Steps: 1) Personal Info  2) Employment  3) Documents  4) Proof of Address  5) Review & Submit
 * i18n + theme-aware, neon green (#C7FF00) + black aesthetic
 */

import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, ArrowRight, User, Briefcase, FileText, MapPin,
  CheckCircle, Loader2, Upload, X, AlertCircle, ShieldCheck,
  Flag, Building2, BadgeDollarSign, Eye, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { PINVerify } from '../auth/PINVerify';
import { ENV_CONFIG, isFullEnrollment } from '../../utils/config/environment';
import { authAPI } from '../../utils/supabase/client';

/* ──────────────────────────── Types ──────────────────────────── */

type EmploymentStatus = 'EMPLOYED' | 'SELF_EMPLOYED' | 'UNEMPLOYED' | 'STUDENT' | 'RETIRED';
type ResidencyStatus = 'NON_RESIDENT_ALIEN' | 'RESIDENT_ALIEN' | 'US_CITIZEN';
type IdType = 'PASSPORT' | 'NIN' | 'DRIVERS_LICENSE';
type SourceOfFundsName = 'PAYSLIP' | 'BANK_STATEMENT';

interface FormData {
  // Step 1 – Personal
  nationality: string;
  us_residency_status: ResidencyStatus;
  identification_number: string;
  // Step 2 – Employment
  employment_status: EmploymentStatus;
  employment_description: string;
  employer_name: string;
  occupation: string;
  // Step 3 – Documents
  identification_country: string;
  identification_image_front: string;
  identification_image_back: string;
  source_of_funds_name: SourceOfFundsName;
  source_of_funds_data: string;
  // Step 4 – Proof of Address
  proof_id_type: IdType;
  proof_expiration: string;
  proof_file_data: string;
}

const INITIAL_FORM: FormData = {
  nationality: '',
  us_residency_status: 'NON_RESIDENT_ALIEN',
  identification_number: '',
  employment_status: 'EMPLOYED',
  employment_description: '',
  employer_name: '',
  occupation: '',
  identification_country: '',
  identification_image_front: '',
  identification_image_back: '',
  source_of_funds_name: 'PAYSLIP',
  source_of_funds_data: '',
  proof_id_type: 'PASSPORT',
  proof_expiration: '',
  proof_file_data: '',
};

const STEPS = ['personal', 'employment', 'documents', 'address', 'review'] as const;
type Step = typeof STEPS[number];

/* ──────────────────────────── Helpers ─────────────────────────── */

const COUNTRY_OPTIONS = [
  { code: 'NG', label: 'Nigeria 🇳🇬' },
  { code: 'GH', label: 'Ghana 🇬🇭' },
  { code: 'KE', label: 'Kenya 🇰🇪' },
  { code: 'UG', label: 'Uganda 🇺🇬' },
  { code: 'CM', label: 'Cameroon 🇨🇲' },
  { code: 'ZA', label: 'South Africa 🇿🇦' },
  { code: 'US', label: 'United States 🇺🇸' },
  { code: 'GB', label: 'United Kingdom 🇬🇧' },
  { code: 'FR', label: 'France 🇫🇷' },
  { code: 'DE', label: 'Germany 🇩🇪' },
  { code: 'CA', label: 'Canada 🇨🇦' },
  { code: 'BR', label: 'Brazil 🇧🇷' },
  { code: 'IN', label: 'India 🇮🇳' },
  { code: 'SN', label: 'Senegal 🇸🇳' },
  { code: 'CI', label: "Côte d'Ivoire 🇨🇮" },
  { code: 'TZ', label: 'Tanzania 🇹🇿' },
  { code: 'RW', label: 'Rwanda 🇷🇼' },
  { code: 'ET', label: 'Ethiopia 🇪🇹' },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ──────────────────────────── Component ──────────────────────── */

interface Props {
  onBack: () => void;
  onComplete?: () => void;
}

export function USDAccountScreen({ onBack, onComplete }: Props) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  const [currentStep, setCurrentStep] = useState(0);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPinVerify, setShowPinVerify] = useState(false);
  const [submitResult, setSubmitResult] = useState<null | { success: boolean; message: string; reference?: string }>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // KYC gate check
  const storedUser    = authAPI.getStoredUser();
  const kycStatus     = storedUser?.kyc_status || 'pending';
  const userIsVerified = isFullEnrollment(kycStatus);

  // Block if not KYC verified (in live mode)
  if (!userIsVerified) {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text} flex flex-col`}>
        <div className={`p-4 border-b ${tc.border} flex items-center gap-3`}>
          <button onClick={onBack} className={`p-2 ${tc.hoverBg} rounded-xl transition-colors`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="font-bold text-lg">USD Virtual Account</h1>
        </div>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-xs">
            <div className="w-20 h-20 bg-[#C7FF00]/10 rounded-full flex items-center justify-center mx-auto mb-5">
              <ShieldCheck className="w-10 h-10 text-[#C7FF00]" />
            </div>
            <h2 className="text-xl font-bold mb-3">Identity Verification Required</h2>
            <p className={`${tc.textSecondary} text-sm mb-2`}>
              Complete identity verification to continue
            </p>
            <p className={`text-xs ${tc.textMuted} mb-8`}>
              USD account creation requires Full Enrollment (Tier 2) KYC.
            </p>
            <button
              onClick={onBack}
              className="w-full py-3.5 bg-[#C7FF00] text-black font-bold rounded-xl"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const fileInputFront = useRef<HTMLInputElement>(null);
  const fileInputBack = useRef<HTMLInputElement>(null);
  const fileInputSof = useRef<HTMLInputElement>(null);
  const fileInputPoa = useRef<HTMLInputElement>(null);

  const stepInfo = STEPS[currentStep];
  const progress = ((currentStep + 1) / STEPS.length) * 100;

  /* ── Field updater ────────────────────────────────────────────── */
  const updateField = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  /* ── File upload handler ──────────────────────────────────────── */
  const handleFileUpload = useCallback(async (
    file: File,
    target: 'identification_image_front' | 'identification_image_back' | 'source_of_funds_data' | 'proof_file_data'
  ) => {
    const maxSizeMB = 5;
    if (file.size > maxSizeMB * 1024 * 1024) {
      toast.error(t('usdAccount.fileTooLarge'));
      return;
    }
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      toast.error(t('usdAccount.invalidFileType'));
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      updateField(target, base64);
      toast.success(t('usdAccount.fileUploaded'));
    } catch {
      toast.error(t('usdAccount.fileUploadError'));
    }
  }, [t, updateField]);

  /* ── Validation per step ──────────────────────────────────────── */
  const validateStep = (): boolean => {
    const e: Record<string, string> = {};

    if (stepInfo === 'personal') {
      if (!form.nationality) e.nationality = t('usdAccount.required');
      if (!form.identification_number) e.identification_number = t('usdAccount.required');
    }
    if (stepInfo === 'employment') {
      if (!form.employment_description) e.employment_description = t('usdAccount.required');
      if (!form.employer_name) e.employer_name = t('usdAccount.required');
      if (!form.occupation) e.occupation = t('usdAccount.required');
    }
    if (stepInfo === 'documents') {
      if (!form.identification_country) e.identification_country = t('usdAccount.required');
      if (!form.identification_image_front) e.identification_image_front = t('usdAccount.uploadRequired');
    }
    // Step 4 (address) is optional per API spec
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  /* ── Navigation ───────────────────────────────────────────────── */
  const goNext = () => {
    if (!validateStep()) return;
    if (currentStep < STEPS.length - 1) setCurrentStep(prev => prev + 1);
  };

  const goBack = () => {
    if (currentStep > 0) setCurrentStep(prev => prev - 1);
    else onBack();
  };

  /* ── Submit (after PIN) ───────────────────────────────────────── */
  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const payload: any = {
        meta: {
          identification_number: form.identification_number,
          employment_status: form.employment_status,
          employment_description: form.employment_description,
          nationality: form.nationality,
          employer_name: form.employer_name,
          occupation: form.occupation,
          us_residency_status: form.us_residency_status,
        },
        documents: {
          identification_country: form.identification_country,
          identification_image_front: form.identification_image_front,
        },
      };

      if (form.identification_image_back) {
        payload.documents.identification_image_back = form.identification_image_back;
      }
      if (form.source_of_funds_data) {
        payload.documents.source_of_funds = {
          file_name: form.source_of_funds_name,
          file_data: form.source_of_funds_data,
        };
      }
      if (form.proof_file_data) {
        payload.proof_of_address = {
          identification_type: form.proof_id_type,
          file_data: form.proof_file_data,
        };
        if (form.proof_expiration) {
          payload.proof_of_address.identification_expiration = form.proof_expiration;
        }
      }

      const result = await backendAPI.accounts.createUSDAccount(payload);

      if (result.success) {
        setSubmitResult({
          success: true,
          message: result.data?.message || t('usdAccount.successMessage'),
          reference: result.data?.data?.reference,
        });
      } else {
        setSubmitResult({
          success: false,
          message: result.error || t('usdAccount.errorMessage'),
        });
      }
    } catch (err: any) {
      console.error('USD Account creation error:', err);
      setSubmitResult({
        success: false,
        message: err.message || t('usdAccount.errorMessage'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onPinVerified = () => {
    setShowPinVerify(false);
    handleSubmit();
  };

  /* ── Select dropdown component ────────────────────────────────── */
  const Select = ({ value, onChange, options, placeholder, error }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    placeholder?: string;
    error?: string;
  }) => (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full appearance-none ${tc.inputBg} border ${error ? 'border-red-500/60' : tc.borderLight} rounded-2xl px-4 py-4 pr-10 text-sm font-medium focus:outline-none focus:border-[#C7FF00]/50 ${tc.text} ${!value ? tc.textMuted : ''}`}
      >
        <option value="">{placeholder || t('common.select')}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none ${tc.textMuted}`} />
      {error && <p className="text-xs text-red-400 mt-1 px-1">{error}</p>}
    </div>
  );

  /* ── Text input component ─────────────────────────────────────── */
  const Input = ({ value, onChange, placeholder, error, type = 'text', autoFocus }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    error?: string;
    type?: string;
    autoFocus?: boolean;
  }) => (
    <div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`w-full ${tc.inputBg} border ${error ? 'border-red-500/60' : tc.borderLight} rounded-2xl px-4 py-4 text-sm font-medium focus:outline-none focus:border-[#C7FF00]/50 ${tc.text} placeholder:${tc.textMuted}`}
      />
      {error && <p className="text-xs text-red-400 mt-1 px-1">{error}</p>}
    </div>
  );

  /* ── File upload button ───────────────────────────────────────── */
  const FileUploadButton = ({ hasFile, label, onClear, inputRef, error, accept }: {
    hasFile: boolean;
    label: string;
    onClear: () => void;
    inputRef: React.RefObject<HTMLInputElement | null>;
    error?: string;
    accept?: string;
  }) => (
    <div>
      {hasFile ? (
        <div className="flex items-center gap-3 bg-[#C7FF00]/10 border border-[#C7FF00]/30 rounded-2xl px-4 py-3.5">
          <CheckCircle size={18} className="text-[#C7FF00] flex-shrink-0" />
          <span className="text-sm font-medium text-[#C7FF00] flex-1 truncate">{label}</span>
          <button onClick={onClear} className="p-1 rounded-full hover:bg-red-500/20 transition-colors">
            <X size={14} className="text-red-400" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className={`w-full flex items-center gap-3 ${tc.inputBg} border ${error ? 'border-red-500/60' : `border-dashed ${tc.borderLight}`} rounded-2xl px-4 py-4 transition-colors hover:border-[#C7FF00]/40`}
        >
          <Upload size={18} className={tc.textMuted} />
          <span className={`text-sm ${tc.textMuted}`}>{label}</span>
        </button>
      )}
      {error && <p className="text-xs text-red-400 mt-1 px-1">{error}</p>}
    </div>
  );

  /* ──────────── Step renderers ──────────────────────────────────── */

  const renderPersonalStep = () => (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
          <User size={20} className="text-blue-400" />
        </div>
        <div>
          <h3 className={`text-base font-bold ${tc.text}`}>{t('usdAccount.personalTitle')}</h3>
          <p className={`text-xs ${tc.textMuted}`}>{t('usdAccount.personalDesc')}</p>
        </div>
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('usdAccount.nationality')}</label>
        <Select
          value={form.nationality}
          onChange={v => updateField('nationality', v)}
          options={COUNTRY_OPTIONS.map(c => ({ value: c.code, label: c.label }))}
          placeholder={t('usdAccount.selectNationality')}
          error={errors.nationality}
        />
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('usdAccount.usResidency')}</label>
        <Select
          value={form.us_residency_status}
          onChange={v => updateField('us_residency_status', v as ResidencyStatus)}
          options={[
            { value: 'NON_RESIDENT_ALIEN', label: t('usdAccount.nonResidentAlien') },
            { value: 'RESIDENT_ALIEN', label: t('usdAccount.residentAlien') },
            { value: 'US_CITIZEN', label: t('usdAccount.usCitizen') },
          ]}
        />
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('usdAccount.identificationNumber')}</label>
        <Input
          value={form.identification_number}
          onChange={v => updateField('identification_number', v)}
          placeholder={t('usdAccount.identificationPlaceholder')}
          error={errors.identification_number}
          autoFocus
        />
        <p className={`text-[11px] ${tc.textMuted} mt-1 px-1`}>{t('usdAccount.identificationHint')}</p>
      </div>
    </div>
  );

  const renderEmploymentStep = () => (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
          <Briefcase size={20} className="text-purple-400" />
        </div>
        <div>
          <h3 className={`text-base font-bold ${tc.text}`}>{t('usdAccount.employmentTitle')}</h3>
          <p className={`text-xs ${tc.textMuted}`}>{t('usdAccount.employmentDesc')}</p>
        </div>
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('usdAccount.employmentStatus')}</label>
        <Select
          value={form.employment_status}
          onChange={v => updateField('employment_status', v as EmploymentStatus)}
          options={[
            { value: 'EMPLOYED', label: t('usdAccount.employed') },
            { value: 'SELF_EMPLOYED', label: t('usdAccount.selfEmployed') },
            { value: 'UNEMPLOYED', label: t('usdAccount.unemployed') },
            { value: 'STUDENT', label: t('usdAccount.student') },
            { value: 'RETIRED', label: t('usdAccount.retired') },
          ]}
        />
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('usdAccount.employmentDescription')}</label>
        <Input
          value={form.employment_description}
          onChange={v => updateField('employment_description', v)}
          placeholder={t('usdAccount.employmentDescPlaceholder')}
          error={errors.employment_description}
        />
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('usdAccount.employerName')}</label>
        <Input
          value={form.employer_name}
          onChange={v => updateField('employer_name', v)}
          placeholder={t('usdAccount.employerPlaceholder')}
          error={errors.employer_name}
        />
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('usdAccount.occupation')}</label>
        <Input
          value={form.occupation}
          onChange={v => updateField('occupation', v)}
          placeholder={t('usdAccount.occupationPlaceholder')}
          error={errors.occupation}
        />
      </div>
    </div>
  );

  const renderDocumentsStep = () => (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
          <FileText size={20} className="text-orange-400" />
        </div>
        <div>
          <h3 className={`text-base font-bold ${tc.text}`}>{t('usdAccount.documentsTitle')}</h3>
          <p className={`text-xs ${tc.textMuted}`}>{t('usdAccount.documentsDesc')}</p>
        </div>
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('usdAccount.idCountry')}</label>
        <Select
          value={form.identification_country}
          onChange={v => updateField('identification_country', v)}
          options={COUNTRY_OPTIONS.map(c => ({ value: c.code, label: c.label }))}
          placeholder={t('usdAccount.selectIdCountry')}
          error={errors.identification_country}
        />
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>
          {t('usdAccount.idFront')} <span className="text-red-400">*</span>
        </label>
        <FileUploadButton
          hasFile={!!form.identification_image_front}
          label={form.identification_image_front ? t('usdAccount.documentUploaded') : t('usdAccount.uploadIdFront')}
          onClear={() => updateField('identification_image_front', '')}
          inputRef={fileInputFront}
          error={errors.identification_image_front}
        />
        <input
          ref={fileInputFront}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/heic,image/heif,application/pdf"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFileUpload(f, 'identification_image_front');
          }}
        />
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('usdAccount.idBack')}</label>
        <FileUploadButton
          hasFile={!!form.identification_image_back}
          label={form.identification_image_back ? t('usdAccount.documentUploaded') : t('usdAccount.uploadIdBack')}
          onClear={() => updateField('identification_image_back', '')}
          inputRef={fileInputBack}
        />
        <input
          ref={fileInputBack}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/heic,image/heif,application/pdf"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFileUpload(f, 'identification_image_back');
          }}
        />
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('usdAccount.sourceOfFunds')}</label>
        <Select
          value={form.source_of_funds_name}
          onChange={v => updateField('source_of_funds_name', v as SourceOfFundsName)}
          options={[
            { value: 'PAYSLIP', label: t('usdAccount.payslip') },
            { value: 'BANK_STATEMENT', label: t('usdAccount.bankStatement') },
          ]}
        />
        <div className="mt-2">
          <FileUploadButton
            hasFile={!!form.source_of_funds_data}
            label={form.source_of_funds_data ? t('usdAccount.documentUploaded') : t('usdAccount.uploadSof')}
            onClear={() => updateField('source_of_funds_data', '')}
            inputRef={fileInputSof}
          />
          <input
            ref={fileInputSof}
            type="file"
            accept="image/jpeg,image/jpg,image/png,application/pdf"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFileUpload(f, 'source_of_funds_data');
            }}
          />
        </div>
      </div>
    </div>
  );

  const renderAddressStep = () => (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center">
          <MapPin size={20} className="text-cyan-400" />
        </div>
        <div>
          <h3 className={`text-base font-bold ${tc.text}`}>{t('usdAccount.addressTitle')}</h3>
          <p className={`text-xs ${tc.textMuted}`}>{t('usdAccount.addressDesc')}</p>
        </div>
      </div>

      <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl">
        <AlertCircle size={15} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <p className={`text-[11px] ${tc.textMuted}`}>{t('usdAccount.addressOptionalNote')}</p>
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('usdAccount.idType')}</label>
        <Select
          value={form.proof_id_type}
          onChange={v => updateField('proof_id_type', v as IdType)}
          options={[
            { value: 'PASSPORT', label: t('usdAccount.passport') },
            { value: 'NIN', label: t('usdAccount.nin') },
            { value: 'DRIVERS_LICENSE', label: t('usdAccount.driversLicense') },
          ]}
        />
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('usdAccount.idExpiration')}</label>
        <Input
          value={form.proof_expiration}
          onChange={v => updateField('proof_expiration', v)}
          placeholder="DD-MM-YYYY"
        />
        <p className={`text-[11px] ${tc.textMuted} mt-1 px-1`}>{t('usdAccount.expirationHint')}</p>
      </div>

      <div>
        <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('usdAccount.proofDocument')}</label>
        <FileUploadButton
          hasFile={!!form.proof_file_data}
          label={form.proof_file_data ? t('usdAccount.documentUploaded') : t('usdAccount.uploadPoa')}
          onClear={() => updateField('proof_file_data', '')}
          inputRef={fileInputPoa}
        />
        <input
          ref={fileInputPoa}
          type="file"
          accept="image/jpeg,image/jpg,image/png,application/pdf"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFileUpload(f, 'proof_file_data');
          }}
        />
        <p className={`text-[11px] ${tc.textMuted} mt-1 px-1`}>{t('usdAccount.poaAccepted')}</p>
      </div>
    </div>
  );

  const renderReviewStep = () => {
    const nationality = COUNTRY_OPTIONS.find(c => c.code === form.nationality)?.label || form.nationality;
    const idCountry = COUNTRY_OPTIONS.find(c => c.code === form.identification_country)?.label || form.identification_country;

    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-full bg-[#C7FF00]/10 flex items-center justify-center">
            <Eye size={20} className="text-[#C7FF00]" />
          </div>
          <div>
            <h3 className={`text-base font-bold ${tc.text}`}>{t('usdAccount.reviewTitle')}</h3>
            <p className={`text-xs ${tc.textMuted}`}>{t('usdAccount.reviewDesc')}</p>
          </div>
        </div>

        {/* Personal Summary */}
        <SummarySection title={t('usdAccount.personalTitle')} icon={<User size={16} className="text-blue-400" />} tc={tc}>
          <SummaryRow label={t('usdAccount.nationality')} value={nationality} tc={tc} />
          <SummaryRow label={t('usdAccount.usResidency')} value={form.us_residency_status.replace(/_/g, ' ')} tc={tc} />
          <SummaryRow label={t('usdAccount.identificationNumber')} value={`••••${form.identification_number.slice(-4)}`} tc={tc} />
        </SummarySection>

        {/* Employment Summary */}
        <SummarySection title={t('usdAccount.employmentTitle')} icon={<Briefcase size={16} className="text-purple-400" />} tc={tc}>
          <SummaryRow label={t('usdAccount.employmentStatus')} value={form.employment_status.replace(/_/g, ' ')} tc={tc} />
          <SummaryRow label={t('usdAccount.employerName')} value={form.employer_name} tc={tc} />
          <SummaryRow label={t('usdAccount.occupation')} value={form.occupation} tc={tc} />
          <SummaryRow label={t('usdAccount.employmentDescription')} value={form.employment_description} tc={tc} />
        </SummarySection>

        {/* Documents Summary */}
        <SummarySection title={t('usdAccount.documentsTitle')} icon={<FileText size={16} className="text-orange-400" />} tc={tc}>
          <SummaryRow label={t('usdAccount.idCountry')} value={idCountry} tc={tc} />
          <SummaryRow label={t('usdAccount.idFront')} value={form.identification_image_front ? '✅' : '—'} tc={tc} />
          <SummaryRow label={t('usdAccount.idBack')} value={form.identification_image_back ? '✅' : '—'} tc={tc} />
          <SummaryRow label={t('usdAccount.sourceOfFunds')} value={form.source_of_funds_data ? form.source_of_funds_name : '—'} tc={tc} />
        </SummarySection>

        {/* Address Summary */}
        {form.proof_file_data && (
          <SummarySection title={t('usdAccount.addressTitle')} icon={<MapPin size={16} className="text-cyan-400" />} tc={tc}>
            <SummaryRow label={t('usdAccount.idType')} value={form.proof_id_type.replace(/_/g, ' ')} tc={tc} />
            {form.proof_expiration && <SummaryRow label={t('usdAccount.idExpiration')} value={form.proof_expiration} tc={tc} />}
            <SummaryRow label={t('usdAccount.proofDocument')} value="✅" tc={tc} />
          </SummarySection>
        )}

        {/* Disclaimer */}
        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <ShieldCheck size={15} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <p className={`text-[11px] ${tc.textMuted}`}>{t('usdAccount.disclaimer')}</p>
        </div>
      </div>
    );
  };

  /* ──────────── Result screen ───────────────────────────────────── */
  if (submitResult) {
    return (
      <div className={`min-h-screen ${tc.bg} pb-safe`}>
        <div className={`sticky top-0 z-30 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
          <div className="flex items-center justify-between px-5 py-4 pt-safe">
            <div className="w-10" />
            <h1 className={`text-base font-bold ${tc.text}`}>{t('usdAccount.title')}</h1>
            <div className="w-10" />
          </div>
        </div>

        <div className="flex flex-col items-center justify-center px-5 py-16 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className={`w-24 h-24 rounded-full ${submitResult.success ? 'bg-[#C7FF00]/10' : 'bg-red-500/10'} flex items-center justify-center mb-6`}
          >
            {submitResult.success ? (
              <CheckCircle size={48} className="text-[#C7FF00]" />
            ) : (
              <AlertCircle size={48} className="text-red-400" />
            )}
          </motion.div>

          <h2 className={`text-xl font-bold ${tc.text} mb-3`}>
            {submitResult.success ? t('usdAccount.successTitle') : t('usdAccount.errorTitle')}
          </h2>
          <p className={`text-sm ${tc.textMuted} mb-2 max-w-xs`}>{submitResult.message}</p>
          {submitResult.reference && (
            <p className={`text-xs font-mono ${tc.textMuted} mb-8`}>
              Ref: {submitResult.reference}
            </p>
          )}

          <div className="w-full space-y-3 max-w-xs">
            {submitResult.success && (
              <button
                onClick={() => { onComplete?.(); onBack(); }}
                className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98]"
              >
                {t('usdAccount.done')}
              </button>
            )}
            {!submitResult.success && (
              <button
                onClick={() => { setSubmitResult(null); setCurrentStep(STEPS.length - 1); }}
                className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98]"
              >
                {t('usdAccount.tryAgain')}
              </button>
            )}
            <button
              onClick={onBack}
              className={`w-full ${tc.card} border ${tc.borderLight} py-4 rounded-full font-bold ${tc.text} ${tc.hoverBg} transition-all active:scale-[0.98]`}
            >
              {t('usdAccount.backToDashboard')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ──────────── Main render ─────────────────────────────────────── */
  return (
    <div className={`min-h-screen ${tc.bg} pb-safe`}>
      {/* Header */}
      <div className={`sticky top-0 z-30 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-5 py-4 pt-safe">
          <button
            onClick={goBack}
            className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}
          >
            <ArrowLeft size={20} className={tc.text} />
          </button>
          <h1 className={`text-base font-bold ${tc.text}`}>{t('usdAccount.title')}</h1>
          <div className="w-10" />
        </div>

        {/* Progress bar */}
        <div className="px-5 pb-3">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((step, idx) => {
              const StepIcon = [User, Briefcase, FileText, MapPin, CheckCircle][idx];
              const isActive = idx === currentStep;
              const isDone = idx < currentStep;
              return (
                <button
                  key={step}
                  onClick={() => idx < currentStep && setCurrentStep(idx)}
                  disabled={idx > currentStep}
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                    isActive ? 'bg-[#C7FF00] text-black scale-110' :
                    isDone ? 'bg-[#C7FF00]/20 text-[#C7FF00]' :
                    `${tc.card} ${tc.textMuted}`
                  }`}
                >
                  <StepIcon size={16} />
                </button>
              );
            })}
          </div>
          <div className={`h-1 rounded-full ${tc.bgAlt} overflow-hidden`}>
            <motion.div
              className="h-full bg-[#C7FF00] rounded-full"
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <p className={`text-[11px] ${tc.textMuted} mt-1.5 text-center`}>
            {t('usdAccount.step')} {currentStep + 1} / {STEPS.length} — {t(`usdAccount.stepName_${stepInfo}`)}
          </p>
        </div>
      </div>

      {/* Step Content */}
      <div className="px-5 py-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={stepInfo}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.2 }}
          >
            {stepInfo === 'personal' && renderPersonalStep()}
            {stepInfo === 'employment' && renderEmploymentStep()}
            {stepInfo === 'documents' && renderDocumentsStep()}
            {stepInfo === 'address' && renderAddressStep()}
            {stepInfo === 'review' && renderReviewStep()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation Buttons */}
      <div className="fixed bottom-0 left-0 right-0 px-5 py-4 pb-safe bg-gradient-to-t from-black/90 via-black/70 to-transparent z-20">
        <div className="flex gap-3">
          {currentStep > 0 && (
            <button
              onClick={goBack}
              className={`flex-1 ${tc.card} border ${tc.borderLight} py-4 rounded-full font-bold ${tc.text} ${tc.hoverBg} transition-all active:scale-[0.98] flex items-center justify-center gap-2`}
            >
              <ArrowLeft size={16} />
              {t('common.back')}
            </button>
          )}

          {currentStep < STEPS.length - 1 ? (
            <button
              onClick={goNext}
              className="flex-[2] bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {t('common.next')}
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              onClick={() => setShowPinVerify(true)}
              disabled={isSubmitting}
              className="flex-[2] bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  {t('common.processing')}
                </>
              ) : (
                <>
                  <ShieldCheck size={18} />
                  {t('usdAccount.submit')}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* PIN Verification Overlay */}
      {showPinVerify && (
        <PINVerify
          onVerifySuccess={onPinVerified}
          onCancel={() => setShowPinVerify(false)}
          transactionType="USD Account Creation"
        />
      )}
    </div>
  );
}

/* ──────────── Summary helper components ─────────────────────────── */

function SummarySection({ title, icon, tc, children }: {
  title: string;
  icon: React.ReactNode;
  tc: any;
  children: React.ReactNode;
}) {
  return (
    <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h4 className={`text-sm font-bold ${tc.text}`}>{title}</h4>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SummaryRow({ label, value, tc }: { label: string; value: string; tc: any }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${tc.textMuted}`}>{label}</span>
      <span className={`text-xs font-medium ${tc.text} text-right max-w-[55%] truncate`}>{value}</span>
    </div>
  );
}