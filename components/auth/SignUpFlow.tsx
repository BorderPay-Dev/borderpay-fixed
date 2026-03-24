import { BorderPayLogo } from '../cards/BorderPayLogo';
/**
 * BorderPay Africa - Complete Signup Flow
 * Multi-step registration: Personal Info → DOB/ID → SmileID → Address → PoA Upload → Pending
 * 
 * Flow:
 * 1. Basic Info (name, email, phone, country, password)
 * 2. Date of Birth + ID document type selection
 * 3. SmileID verification (ID + selfie) - embedded iframe
 * 4. Address details (street, city, state, postal)
 * 5. Proof of Address upload (utility bill, bank statement, etc.)
 * 6. Review & Submit → enroll-customer-full
 * 7. Pending → Dashboard
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Eye, EyeOff, Mail, Lock, User, Phone, ChevronDown, Loader2,
  Globe, Search, X, ArrowRight, ArrowLeft, Calendar, CreditCard,
  Shield, MapPin, Upload, FileText, CheckCircle, Camera, Clock,
  AlertCircle, Home, Building, Hash
} from 'lucide-react';
import { supabase, authAPI } from '../../utils/supabase/client';
import { toast } from 'sonner';
import { publicAnonKey } from '../../utils/supabase/info';
import { backendAPI } from '../../utils/api/backendAPI';
import { getAllowedCountries, getPopularCountries } from '../../utils/countries/allowedCountries';
import { friendlyError } from '../../utils/errors/friendlyError';
import type { Country } from '../../utils/countries/allCountries';

import { TermsOfServiceScreen } from '../legal/TermsOfServiceScreen';
import { PrivacyPolicyScreen } from '../legal/PrivacyPolicyScreen';
import { KYCVerification } from '../kyc/KYCVerification';

// ============================================================================
// TYPES
// ============================================================================

type SignUpStep = 'personal' | 'confirm-email' | 'identity' | 'smile-id' | 'address' | 'proof-of-address' | 'review' | 'pending';

interface SignUpData {
  // Step 1: Personal
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  selectedCountry: Country | null;
  agreedToTerms: boolean;
  // Step 2: Identity
  dateOfBirth: string; // DD-MM-YYYY
  idType: 'NIN' | 'PASSPORT' | 'VOTERS_CARD' | 'DRIVERS_LICENSE' | '';
  idNumber: string;
  // Step 3: SmileID status
  smileIdStatus: 'pending' | 'verified' | 'failed' | 'not_started';
  // Step 4: Address
  street: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  // Step 5: Proof of Address
  poaDocumentType: 'utility_bill' | 'bank_statement' | 'tenancy_agreement' | 'government_letter' | '';
  poaFile: File | null;
  poaUploaded: boolean;
}

interface SignUpFlowProps {
  onSignUpSuccess: (user: any) => void;
  onNavigateToLogin: () => void;
}

// ============================================================================
// IDENTITY TYPES BY COUNTRY
// ============================================================================

const ID_TYPES_BY_COUNTRY: Record<string, Array<{ value: string; label: string }>> = {
  NG: [
    { value: 'NIN', label: 'National Identification Number (NIN)' },
    { value: 'VOTERS_CARD', label: "Voter's Card" },
    { value: 'DRIVERS_LICENSE', label: "Driver's License" },
    { value: 'PASSPORT', label: 'International Passport' },
  ],
  GH: [
    { value: 'PASSPORT', label: 'International Passport' },
    { value: 'DRIVERS_LICENSE', label: "Driver's License" },
    { value: 'VOTERS_CARD', label: "Voter's ID" },
  ],
  KE: [
    { value: 'NIN', label: 'National ID' },
    { value: 'PASSPORT', label: 'International Passport' },
  ],
  UG: [
    { value: 'NIN', label: 'National ID' },
    { value: 'PASSPORT', label: 'International Passport' },
  ],
  DEFAULT: [
    { value: 'PASSPORT', label: 'International Passport' },
    { value: 'DRIVERS_LICENSE', label: "Driver's License" },
    { value: 'NIN', label: 'National ID' },
  ],
};

const POA_DOCUMENT_TYPES = [
  { value: 'utility_bill', label: 'Utility Bill', desc: 'Electricity, water, gas (max 3 months old)' },
  { value: 'bank_statement', label: 'Bank Statement', desc: 'Official bank statement (max 3 months old)' },
  { value: 'tenancy_agreement', label: 'Tenancy Agreement', desc: 'Current rental/lease agreement' },
  { value: 'government_letter', label: 'Government Letter', desc: 'Tax letter, official correspondence' },
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function SignUpFlow({ onSignUpSuccess, onNavigateToLogin }: SignUpFlowProps) {
  const [currentStep, setCurrentStep] = useState<SignUpStep>('personal');
  const [isLoading, setIsLoading] = useState(false);
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [enrollmentComplete, setEnrollmentComplete] = useState(false);
  const [formError, setFormError] = useState('');

  const [formData, setFormData] = useState<SignUpData>({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    selectedCountry: null, // No default - user must explicitly select their country
    agreedToTerms: false,
    dateOfBirth: '',
    idType: '',
    idNumber: '',
    smileIdStatus: 'not_started',
    street: '',
    street2: '',
    city: '',
    state: '',
    postalCode: '',
    poaDocumentType: '',
    poaFile: null,
    poaUploaded: false,
  });

  const updateForm = (updates: Partial<SignUpData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  const steps: SignUpStep[] = ['personal', 'confirm-email', 'identity', 'smile-id', 'address', 'proof-of-address', 'review', 'pending'];
  const currentStepIndex = steps.indexOf(currentStep);
  const totalSteps = 7; // Don't count 'pending'

  // ============================================================================
  // STEP 1: CREATE ACCOUNT (after personal info)
  // ============================================================================

  const handleCreateAccount = async () => {
    const { fullName, email, phone, password, confirmPassword, selectedCountry, agreedToTerms } = formData;

    setFormError('');

    if (!fullName || !email || !phone || !password || !confirmPassword) {
      const msg = 'Please fill in all fields.';
      setFormError(msg); toast.error(msg); return;
    }
    if (!selectedCountry) {
      const msg = 'Please select your country of residence.';
      setFormError(msg); toast.error(msg); return;
    }
    if (password !== confirmPassword) {
      const msg = 'Passwords do not match. Please re-enter.';
      setFormError(msg); toast.error(msg); return;
    }
    if (password.length < 12) {
      const msg = 'Password must be at least 12 characters.';
      setFormError(msg); toast.error(msg); return;
    }
    if (!agreedToTerms) {
      const msg = 'Please agree to the Terms & Conditions to continue.';
      setFormError(msg); toast.error(msg); return;
    }

    setIsLoading(true);
    try {
      const result = await backendAPI.auth.signup({
        email,
        password,
        full_name: fullName,
        phone_number: `${selectedCountry?.dialCode}${phone}`,
        country_code: selectedCountry?.code,
      }, publicAnonKey);

      if (!result.success) {
        throw new Error(result.error || 'Signup failed');
      }

      // Store signup data temporarily for after email confirmation
      localStorage.setItem('borderpay_pending_signup', JSON.stringify({
        email,
        full_name: fullName,
      }));

      // Try to send branded confirmation email via Resend
      try {
        const confirmUrl = `${window.location.origin}/auth/confirm?email=${encodeURIComponent(email)}`;
        await fetch(`${import.meta.env.VITE_SUPABASE_URL || `https://orwrcpwsffjlvzuraxjc.supabase.co`}/functions/v1/send-confirmation-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: publicAnonKey },
          body: JSON.stringify({ email, full_name: fullName, confirmation_url: confirmUrl }),
        });
      } catch { /* Supabase default email will be sent as fallback */ }

      toast.success('Account created! Check your email to verify.');
      setCurrentStep('confirm-email');
    } catch (error: any) {
      const msg = friendlyError(error, 'Failed to create account. Please try again.');
      setFormError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // STEP 3: SmileID completion handler
  // ============================================================================

  const handleSmileIdComplete = (status: 'verified' | 'failed' | 'pending') => {
    updateForm({ smileIdStatus: status });
    if (status === 'verified' || status === 'pending') {
      // Even if pending (SmileID processes async), move forward to address
      toast.success(status === 'verified' 
        ? 'Identity verified! Now add your address.' 
        : 'Verification submitted! Continue with your address while we process.');
      setCurrentStep('address');
    } else {
      toast.error('Verification failed. You can retry or continue.');
    }
  };

  // ============================================================================
  // STEP 5: Upload Proof of Address
  // ============================================================================

  const handlePoAUpload = async () => {
    if (!formData.poaFile || !formData.poaDocumentType) {
      toast.error('Please select a document type and file');
      return;
    }

    setIsLoading(true);
    try {
      // Step 1: Get signed upload URL
      const uploadUrlData = await backendAPI.proofOfAddress.getUploadUrl(
        formData.poaFile.type,
        formData.poaFile.name
      );
      if (!uploadUrlData.success) throw new Error(uploadUrlData.error || 'Failed to get upload URL');

      // Step 2: Upload the file
      const uploadRes = await fetch(uploadUrlData.data.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': formData.poaFile.type },
        body: formData.poaFile,
      });

      if (!uploadRes.ok) throw new Error('File upload failed');

      // Step 3: Submit for review
      const submitData = await backendAPI.proofOfAddress.submit(
        uploadUrlData.data.path,
        formData.poaDocumentType
      );
      if (!submitData.success) throw new Error(submitData.error || 'Submission failed');

      updateForm({ poaUploaded: true });
      toast.success('Proof of address submitted!');
      setCurrentStep('review');
    } catch (error: any) {
      toast.error(friendlyError(error, 'Upload failed'));
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // STEP 6: Submit to backend
  // ============================================================================

  const handleEnrollCustomer = async () => {
    setIsLoading(true);
    try {
      const token = authAPI.getToken();
      const nameParts = formData.fullName.trim().split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || nameParts[0];

      const enrollPayload = {
        first_name: firstName,
        last_name: lastName,
        email: formData.email,
        country: formData.selectedCountry?.code,
        identification_number: formData.idNumber,
        dob: formData.dateOfBirth, // DD-MM-YYYY
        phone: {
          phone_country_code: formData.selectedCountry?.dialCode,
          phone_number: formData.phone,
        },
        identity: {
          type: formData.idType,
          number: formData.idNumber,
          image: '', // SmileID provides this via their dashboard
          country: formData.selectedCountry?.code,
        },
        address: {
          street: formData.street,
          street2: formData.street2 || undefined,
          city: formData.city,
          state: formData.state,
          country: formData.selectedCountry?.code,
          postal_code: formData.postalCode,
        },
      };

      const result = await backendAPI.enrollment.enrollCustomer(enrollPayload);

      if (!result.success) {
        // Don't block - user can proceed to dashboard, enrollment can be retried
        toast.error(friendlyError(result.error, 'Enrollment submitted with issues. Our team will follow up.'));
      } else {
        toast.success('Registration complete! Your account is under review.');
        setEnrollmentComplete(true);
      }

      setCurrentStep('pending');
    } catch (error: any) {
      toast.error('Submission error. You can proceed - our team will complete your setup.');
      setCurrentStep('pending');
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // PROCEED TO DASHBOARD (from pending)
  // ============================================================================

  const handleProceedToDashboard = async () => {
    const storedUser = authAPI.getStoredUser();
    if (storedUser) {
      onSignUpSuccess(storedUser);
    } else {
      // Fallback
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        onSignUpSuccess(data.user);
      }
    }
  };

  // ============================================================================
  // PROGRESS BAR
  // ============================================================================

  const ProgressBar = () => (
    <div className="flex items-center gap-1.5 px-6 py-3">
      {steps.slice(0, totalSteps).map((step, index) => (
        <div key={step} className="flex-1 flex items-center">
          <div
            className={`h-1.5 rounded-full w-full transition-all duration-300 ${
              index < currentStepIndex ? 'bg-[#C7FF00]' 
              : index === currentStepIndex ? 'bg-[#C7FF00]/60' 
              : 'bg-white/10'
            }`}
          />
        </div>
      ))}
    </div>
  );

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-[100dvh] max-h-[100dvh] bg-[#0B0E11] text-white flex flex-col overflow-hidden fixed inset-0">
      {/* Animated gradient background */}
      <div className="glass-gradient-bg" />
      <div className="glass-noise-overlay" />
      
      {/* Header */}
      {currentStep !== 'pending' && (
        <div className="flex-shrink-0 pt-safe relative z-[2]">
          {/* Back button + step indicator */}
          <div className="flex items-center justify-between px-4 py-3">
            {currentStep !== 'personal' ? (
              <button
                onClick={() => {
                  const prevIndex = currentStepIndex - 1;
                  if (prevIndex >= 0) setCurrentStep(steps[prevIndex]);
                }}
                className="p-2 hover:bg-white/5 rounded-xl transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-9" />
            )}
            
            <div className="flex items-center gap-2">
              <BorderPayLogo size={28} color="#000000" />
              <span className="text-sm font-semibold text-gray-400">
                Step {Math.min(currentStepIndex + 1, totalSteps)}/{totalSteps}
              </span>
            </div>

            <div className="w-9" />
          </div>

          <ProgressBar />
        </div>
      )}

      {/* Step Content */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-none relative z-[2]" style={{ WebkitOverflowScrolling: 'touch' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {currentStep === 'personal' && (
              <StepPersonalInfo
                formData={formData}
                updateForm={updateForm}
                onNext={handleCreateAccount}
                isLoading={isLoading}
                onNavigateToLogin={onNavigateToLogin}
                onShowTerms={() => setShowTerms(true)}
                onShowPrivacy={() => setShowPrivacy(true)}
                formError={formError}
                onClearError={() => setFormError('')}
              />
            )}

            {currentStep === 'confirm-email' && (
              <StepConfirmEmail
                email={formData.email}
                fullName={formData.fullName}
                onEmailConfirmed={async () => {
                  // Try to sign in now that email is confirmed
                  try {
                    setIsLoading(true);
                    const { data, error } = await supabase.auth.signInWithPassword({
                      email: formData.email,
                      password: formData.password,
                    });
                    if (error) throw error;
                    if (data.user) {
                      setCreatedUserId(data.user.id);
                      localStorage.setItem('borderpay_user', JSON.stringify({
                        id: data.user.id,
                        email: data.user.email,
                        full_name: formData.fullName,
                        kyc_status: 'pending',
                      }));
                      if (data.session?.access_token) {
                        localStorage.setItem('borderpay_token', data.session.access_token);
                      }
                      if (data.session?.refresh_token) {
                        localStorage.setItem('borderpay_refresh_token', data.session.refresh_token);
                      }
                      localStorage.setItem('borderpay_biometric_user_id', data.user.id);
                      localStorage.removeItem('borderpay_pending_signup');
                      toast.success('Email verified! Continue with verification.');
                      setCurrentStep('identity');
                    }
                  } catch (err: any) {
                    toast.error(friendlyError(err, 'Sign in failed. Please try logging in.'));
                  } finally {
                    setIsLoading(false);
                  }
                }}
                onResend={async () => {
                  try {
                    const confirmUrl = `${window.location.origin}/auth/confirm?email=${encodeURIComponent(formData.email)}`;
                    await fetch(`${import.meta.env.VITE_SUPABASE_URL || `https://orwrcpwsffjlvzuraxjc.supabase.co`}/functions/v1/send-confirmation-email`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', apikey: publicAnonKey },
                      body: JSON.stringify({ email: formData.email, full_name: formData.fullName, confirmation_url: confirmUrl }),
                    });
                    toast.success('Confirmation email resent!');
                  } catch {
                    toast.error('Failed to resend. Please try again.');
                  }
                }}
                isLoading={isLoading}
              />
            )}

            {currentStep === 'identity' && (
              <StepIdentityInfo
                formData={formData}
                updateForm={updateForm}
                onNext={() => setCurrentStep('smile-id')}
              />
            )}

            {currentStep === 'smile-id' && (
              <StepSmileID
                formData={formData}
                userId={createdUserId || ''}
                onComplete={handleSmileIdComplete}
                onSkip={() => {
                  updateForm({ smileIdStatus: 'pending' });
                  setCurrentStep('address');
                }}
              />
            )}

            {currentStep === 'address' && (
              <StepAddress
                formData={formData}
                updateForm={updateForm}
                onNext={() => setCurrentStep('proof-of-address')}
              />
            )}

            {currentStep === 'proof-of-address' && (
              <StepProofOfAddress
                formData={formData}
                updateForm={updateForm}
                onUpload={handlePoAUpload}
                isLoading={isLoading}
              />
            )}

            {currentStep === 'review' && (
              <StepReview
                formData={formData}
                onSubmit={handleEnrollCustomer}
                isLoading={isLoading}
              />
            )}

            {currentStep === 'pending' && (
              <StepPending
                onProceed={handleProceedToDashboard}
                enrollmentComplete={enrollmentComplete}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Legal Overlays */}
      <AnimatePresence>
        {showTerms && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] bg-black overflow-y-auto overscroll-none" style={{ WebkitOverflowScrolling: 'touch' }}>
            <TermsOfServiceScreen onBack={() => setShowTerms(false)} />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showPrivacy && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] bg-black overflow-y-auto overscroll-none" style={{ WebkitOverflowScrolling: 'touch' }}>
            <PrivacyPolicyScreen onBack={() => setShowPrivacy(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// SHARED INPUT COMPONENT
// ============================================================================

function FormInput({ label, icon: Icon, type = 'text', value, onChange, placeholder, rightElement, ...props }: {
  label: string;
  icon: any;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  rightElement?: React.ReactNode;
  [key: string]: any;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 uppercase tracking-[0.15em] font-semibold mb-2">
        {label}
      </label>
      <div className="relative">
        <Icon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full pl-12 pr-4 py-3.5 bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl text-white font-medium focus:outline-none focus:border-[#C7FF00] focus:bg-white/[0.07] focus:shadow-[0_0_20px_rgba(199,255,0,0.15)] transition-all placeholder:text-gray-600 text-sm"
          {...props}
        />
        {rightElement && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {rightElement}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// TIMEZONE → COUNTRY AUTO-DETECTION
// ============================================================================

const TIMEZONE_TO_COUNTRY: Record<string, string> = {
  // ── Africa (primary market) ──
  'Africa/Lagos': 'NG', 'Africa/Accra': 'GH', 'Africa/Nairobi': 'KE',
  'Africa/Johannesburg': 'ZA', 'Africa/Kampala': 'UG', 'Africa/Dar_es_Salaam': 'TZ',
  'Africa/Kigali': 'RW', 'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA',
  'Africa/Abidjan': 'CI', 'Africa/Dakar': 'SN', 'Africa/Addis_Ababa': 'ET',
  'Africa/Lusaka': 'ZM', 'Africa/Harare': 'ZW', 'Africa/Maputo': 'MZ',
  'Africa/Douala': 'CM', 'Africa/Kinshasa': 'CD', 'Africa/Luanda': 'AO',
  'Africa/Tunis': 'TN', 'Africa/Algiers': 'DZ', 'Africa/Tripoli': 'LY',
  'Africa/Bamako': 'ML', 'Africa/Conakry': 'GN', 'Africa/Freetown': 'SL',
  'Africa/Monrovia': 'LR', 'Africa/Banjul': 'GM', 'Africa/Lome': 'TG',
  'Africa/Porto-Novo': 'BJ', 'Africa/Niamey': 'NE', 'Africa/Ouagadougou': 'BF',
  'Africa/Nouakchott': 'MR', 'Africa/Windhoek': 'NA', 'Africa/Gaborone': 'BW',
  'Africa/Maseru': 'LS', 'Africa/Mbabane': 'SZ', 'Africa/Ndjamena': 'TD',
  'Africa/Mogadishu': 'SO', 'Africa/Asmara': 'ER', 'Africa/Djibouti': 'DJ',
  'Africa/Juba': 'SS', 'Africa/Khartoum': 'SD', 'Africa/Malabo': 'GQ',
  'Africa/Libreville': 'GA', 'Africa/Brazzaville': 'CG', 'Africa/Bangui': 'CF',
  'Africa/Sao_Tome': 'ST', 'Africa/Bissau': 'GW', 'Africa/El_Aaiun': 'EH',
  'Indian/Antananarivo': 'MG', 'Indian/Mauritius': 'MU', 'Indian/Comoro': 'KM',
  'Indian/Mayotte': 'YT',
  // ── Europe ──
  'Europe/London': 'GB', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE',
  'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE', 'Europe/Lisbon': 'PT', 'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI', 'Europe/Dublin': 'IE',
  'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Bucharest': 'RO',
  'Europe/Budapest': 'HU', 'Europe/Athens': 'GR', 'Europe/Istanbul': 'TR',
  'Europe/Moscow': 'RU', 'Europe/Kiev': 'UA', 'Europe/Kyiv': 'UA',
  'Europe/Belgrade': 'RS', 'Europe/Zagreb': 'HR', 'Europe/Ljubljana': 'SI',
  'Europe/Bratislava': 'SK', 'Europe/Tallinn': 'EE', 'Europe/Riga': 'LV',
  'Europe/Vilnius': 'LT', 'Europe/Sofia': 'BG', 'Europe/Luxembourg': 'LU',
  'Europe/Malta': 'MT', 'Europe/Monaco': 'MC', 'Europe/Andorra': 'AD',
  'Europe/Tirane': 'AL', 'Europe/Sarajevo': 'BA', 'Europe/Podgorica': 'ME',
  'Europe/Skopje': 'MK', 'Europe/Chisinau': 'MD', 'Europe/Minsk': 'BY',
  'Atlantic/Reykjavik': 'IS', 'Atlantic/Canary': 'ES',
  // ── Americas ──
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Los_Angeles': 'US', 'America/Phoenix': 'US', 'America/Anchorage': 'US',
  'Pacific/Honolulu': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
  'America/Edmonton': 'CA', 'America/Winnipeg': 'CA', 'America/Halifax': 'CA',
  'America/St_Johns': 'CA', 'America/Mexico_City': 'MX', 'America/Cancun': 'MX',
  'America/Tijuana': 'MX', 'America/Bogota': 'CO', 'America/Lima': 'PE',
  'America/Santiago': 'CL', 'America/Buenos_Aires': 'AR',
  'America/Sao_Paulo': 'BR', 'America/Manaus': 'BR', 'America/Recife': 'BR',
  'America/Caracas': 'VE', 'America/Guayaquil': 'EC', 'America/La_Paz': 'BO',
  'America/Asuncion': 'PY', 'America/Montevideo': 'UY', 'America/Guyana': 'GY',
  'America/Paramaribo': 'SR', 'America/Cayenne': 'GF',
  'America/Panama': 'PA', 'America/Costa_Rica': 'CR', 'America/Guatemala': 'GT',
  'America/El_Salvador': 'SV', 'America/Tegucigalpa': 'HN', 'America/Managua': 'NI',
  'America/Belize': 'BZ', 'America/Havana': 'CU', 'America/Port-au-Prince': 'HT',
  'America/Santo_Domingo': 'DO', 'America/Jamaica': 'JM', 'America/Port_of_Spain': 'TT',
  'America/Barbados': 'BB', 'America/Nassau': 'BS',
  // ── Asia & Middle East ──
  'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA',
  'Asia/Bahrain': 'BH', 'Asia/Kuwait': 'KW', 'Asia/Muscat': 'OM',
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Colombo': 'LK',
  'Asia/Dhaka': 'BD', 'Asia/Karachi': 'PK', 'Asia/Kathmandu': 'NP',
  'Asia/Shanghai': 'CN', 'Asia/Hong_Kong': 'HK', 'Asia/Taipei': 'TW',
  'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY', 'Asia/Bangkok': 'TH', 'Asia/Jakarta': 'ID',
  'Asia/Manila': 'PH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Yangon': 'MM',
  'Asia/Phnom_Penh': 'KH', 'Asia/Vientiane': 'LA', 'Asia/Brunei': 'BN',
  'Asia/Tashkent': 'UZ', 'Asia/Almaty': 'KZ', 'Asia/Tbilisi': 'GE',
  'Asia/Yerevan': 'AM', 'Asia/Baku': 'AZ', 'Asia/Beirut': 'LB',
  'Asia/Jerusalem': 'IL', 'Asia/Amman': 'JO', 'Asia/Baghdad': 'IQ',
  'Asia/Tehran': 'IR', 'Asia/Kabul': 'AF', 'Asia/Ulaanbaatar': 'MN',
  // ── Oceania ──
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU', 'Australia/Darwin': 'AU',
  'Pacific/Auckland': 'NZ', 'Pacific/Fiji': 'FJ', 'Pacific/Port_Moresby': 'PG',
  'Pacific/Guam': 'GU', 'Pacific/Tongatapu': 'TO', 'Pacific/Apia': 'WS',
  // ── Indian Ocean ──
  'Indian/Maldives': 'MV', 'Indian/Reunion': 'RE', 'Indian/Mahe': 'SC',
};

function detectCountryFromTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIMEZONE_TO_COUNTRY[tz] || null;
  } catch {
    return null;
  }
}

// ============================================================================
// STEP 1: PERSONAL INFO
// ============================================================================

function StepPersonalInfo({ formData, updateForm, onNext, isLoading, onNavigateToLogin, onShowTerms, onShowPrivacy, formError, onClearError }: {
  formData: SignUpData;
  updateForm: (u: Partial<SignUpData>) => void;
  onNext: () => void;
  isLoading: boolean;
  onNavigateToLogin: () => void;
  onShowTerms: () => void;
  onShowPrivacy: () => void;
  formError?: string;
  onClearError?: () => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState('');

  // Auto-detect country from timezone on first mount (only if no country selected yet)
  useEffect(() => {
    if (!formData.selectedCountry) {
      const detectedCode = detectCountryFromTimezone();
      if (detectedCode) {
        const match = getAllowedCountries().find(c => c.code === detectedCode);
        if (match) {
          updateForm({ selectedCountry: match });
        }
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const popularCountries = getPopularCountries();

  const filteredCountries = useMemo(() => {
    const all = getAllowedCountries();
    if (!countrySearchQuery) return all;
    const q = countrySearchQuery.toLowerCase();
    return all.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      c.dialCode.includes(countrySearchQuery)
    );
  }, [countrySearchQuery]);

  const handleSelectCountry = (country: Country) => {
    updateForm({ selectedCountry: country });
    setShowCountryPicker(false);
    setCountrySearchQuery('');
  };

  return (
    <div className="px-6 pb-8">
      {/* Header */}
      <div className="text-center mb-6 pt-2">
        <div className="w-16 h-16 rounded-2xl bg-[#C7FF00] flex items-center justify-center mx-auto mb-4">
          <BorderPayLogo size={28} color="#000000" />
        </div>
        <h1 className="text-2xl font-bold mb-1">Create Account</h1>
        <p className="text-sm text-gray-400">Join BorderPay Africa</p>
      </div>

      {/* Inline Error Banner */}
      {formError && (
        <div className="mb-4 flex items-start gap-3 bg-[#C7FF00] text-black px-4 py-3 rounded-2xl shadow-[0_0_20px_rgba(199,255,0,0.25)]">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p className="text-sm font-semibold flex-1 leading-snug">{formError}</p>
          {onClearError && (
            <button type="button" onClick={onClearError} className="w-5 h-5 rounded-full bg-black/10 flex items-center justify-center flex-shrink-0">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); onNext(); }} className="space-y-3.5">
        <FormInput
          label="Full Name (as on ID)"
          icon={User}
          value={formData.fullName}
          onChange={(e) => updateForm({ fullName: e.target.value })}
          placeholder="John Doe"
        />

        <FormInput
          label="Email Address"
          icon={Mail}
          type="email"
          value={formData.email}
          onChange={(e) => updateForm({ email: e.target.value })}
          placeholder="you@example.com"
        />

        {/* Country of Residence - Prominent dedicated field */}
        <div>
          <label className="block text-xs text-gray-400 uppercase tracking-[0.15em] font-semibold mb-2">
            Country of Residence <span className="text-[#C7FF00]">*</span>
          </label>
          <button
            type="button"
            onClick={() => setShowCountryPicker(true)}
            className={`w-full flex items-center gap-3 py-3.5 px-4 bg-white/[0.04] backdrop-blur-md border rounded-2xl transition-all text-left ${
              formData.selectedCountry
                ? 'border-[#C7FF00]/40'
                : 'border-red-500/40 animate-pulse'
            }`}
          >
            <Globe className="w-5 h-5 text-gray-500 flex-shrink-0" />
            {formData.selectedCountry ? (
              <div className="flex items-center gap-2.5 flex-1">
                <span className="text-xl">{formData.selectedCountry.flag}</span>
                <span className="text-sm text-white font-medium">{formData.selectedCountry.name}</span>
              </div>
            ) : (
              <span className="text-sm text-gray-500">Select your country...</span>
            )}
            <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
          </button>
          {!formData.selectedCountry && (
            <p className="text-[10px] text-red-400 mt-1.5 ml-1">Required - determines your available services & wallets</p>
          )}
        </div>

        {/* Country Picker Modal */}
        <AnimatePresence>
          {showCountryPicker && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-black/80 flex items-end"
              onClick={() => setShowCountryPicker(false)}
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="w-full bg-[#0B0E11] rounded-t-3xl max-h-[85dvh] flex flex-col border-t border-white/10"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className="w-10 h-1 bg-white/20 rounded-full" />
                </div>

                {/* Header */}
                <div className="px-5 pt-2 pb-3">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold text-white">Select Your Country</h3>
                    <button
                      type="button"
                      onClick={() => setShowCountryPicker(false)}
                      className="p-1.5 rounded-lg hover:bg-white/5"
                    >
                      <X className="w-5 h-5 text-gray-400" />
                    </button>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="text"
                      value={countrySearchQuery}
                      onChange={(e) => setCountrySearchQuery(e.target.value)}
                      placeholder="Search by name or code..."
                      className="w-full pl-9 pr-8 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-[#C7FF00] placeholder:text-gray-600"
                      autoFocus
                    />
                    {countrySearchQuery && (
                      <button type="button" onClick={() => setCountrySearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Popular Countries (only when no search) */}
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-safe pb-6" style={{ WebkitOverflowScrolling: 'touch' }}>
                  {!countrySearchQuery && (
                    <div className="mb-4">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-2">Popular</p>
                      <div className="grid grid-cols-2 gap-2">
                        {popularCountries.map((c) => (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => handleSelectCountry(c)}
                            className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all text-left ${
                              formData.selectedCountry?.code === c.code
                                ? 'bg-[#C7FF00]/10 border-[#C7FF00]/40'
                                : 'bg-white/[0.03] border-white/5 hover:border-white/15'
                            }`}
                          >
                            <span className="text-lg">{c.flag}</span>
                            <span className="text-xs text-white font-medium truncate">{c.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* All Countries */}
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-2">
                    {countrySearchQuery ? `Results (${filteredCountries.length})` : 'All Countries'}
                  </p>
                  <div className="space-y-0.5">
                    {filteredCountries.map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => handleSelectCountry(c)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
                          formData.selectedCountry?.code === c.code
                            ? 'bg-[#C7FF00]/10'
                            : 'hover:bg-white/5'
                        }`}
                      >
                        <span className="text-xl">{c.flag}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">{c.name}</p>
                          <p className="text-[10px] text-gray-500">{c.dialCode} · {c.code}</p>
                        </div>
                        {formData.selectedCountry?.code === c.code && (
                          <CheckCircle className="w-4 h-4 text-[#C7FF00] flex-shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Phone Number - dial code auto-synced from country */}
        <div>
          <label className="block text-xs text-gray-400 uppercase tracking-[0.15em] font-semibold mb-2">
            Phone Number
          </label>
          <div className="flex gap-2">
            <div className="flex items-center gap-1.5 px-3 bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl text-white font-medium text-sm min-w-[80px] justify-center">
              {formData.selectedCountry ? (
                <>
                  <span className="text-lg">{formData.selectedCountry.flag}</span>
                  <span className="text-xs text-gray-300">{formData.selectedCountry.dialCode}</span>
                </>
              ) : (
                <span className="text-xs text-gray-500">---</span>
              )}
            </div>

            <div className="flex-1 relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => updateForm({ phone: e.target.value.replace(/\D/g, '') })}
                placeholder="8012345678"
                className="w-full pl-12 pr-4 py-3.5 bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl text-white font-medium focus:outline-none focus:border-[#C7FF00] focus:bg-white/[0.07] focus:shadow-[0_0_20px_rgba(199,255,0,0.15)] transition-all placeholder:text-gray-600 text-sm"
              />
            </div>
          </div>
        </div>

        <FormInput
          label="Password"
          icon={Lock}
          type={showPassword ? 'text' : 'password'}
          value={formData.password}
          onChange={(e) => updateForm({ password: e.target.value })}
          placeholder="Min. 12 characters"
          rightElement={
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-gray-500 hover:text-white">
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          }
        />

        <FormInput
          label="Confirm Password"
          icon={Lock}
          type={showConfirmPassword ? 'text' : 'password'}
          value={formData.confirmPassword}
          onChange={(e) => updateForm({ confirmPassword: e.target.value })}
          placeholder="Re-enter password"
          rightElement={
            <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="text-gray-500 hover:text-white">
              {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          }
        />

        {/* Terms */}
        <div className="flex items-start gap-3 py-1">
          <input
            type="checkbox"
            id="terms-flow"
            checked={formData.agreedToTerms}
            onChange={(e) => updateForm({ agreedToTerms: e.target.checked })}
            className="w-5 h-5 mt-0.5 rounded border-white/[0.08] bg-white/[0.04] text-[#C7FF00] focus:ring-[#C7FF00] cursor-pointer"
          />
          <label htmlFor="terms-flow" className="text-xs text-gray-400 leading-relaxed">
            I agree to BorderPay's{' '}
            <button type="button" onClick={onShowTerms} className="text-[#C7FF00] font-semibold underline">
              Terms & Conditions
            </button>
            {' '}and{' '}
            <button type="button" onClick={onShowPrivacy} className="text-[#C7FF00] font-semibold underline">
              Privacy Policy
            </button>
          </label>
        </div>

        {/* Submit */}
        <motion.button
          type="submit"
          disabled={isLoading || !formData.selectedCountry}
          whileTap={{ scale: 0.98 }}
          className="w-full bg-[#C7FF00] text-black py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[#D4FF33] disabled:opacity-50 disabled:cursor-not-allowed mt-1"
        >
          {isLoading ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Creating account...</>
          ) : (
            <>Create Account <ArrowRight className="w-4 h-4" /></>
          )}
        </motion.button>
      </form>

      {/* Login Link */}
      <div className="text-center mt-4 pb-4">
        <p className="text-sm text-gray-400">
          Already have an account?{' '}
          <button onClick={onNavigateToLogin} className="text-[#C7FF00] font-semibold hover:underline">
            Sign In
          </button>
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// EMAIL CONFIRMATION STEP
// ============================================================================

function StepConfirmEmail({ email, fullName, onEmailConfirmed, onResend, isLoading }: {
  email: string;
  fullName: string;
  onEmailConfirmed: () => void;
  onResend: () => void;
  isLoading: boolean;
}) {
  const [resendCooldown, setResendCooldown] = useState(0);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleResend = () => {
    onResend();
    setResendCooldown(60);
  };

  const handleCheckConfirmation = async () => {
    setChecking(true);
    // Give a moment for the UI, then try signing in
    await new Promise(r => setTimeout(r, 500));
    onEmailConfirmed();
    setChecking(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6 px-1"
    >
      <div className="flex flex-col items-center text-center pt-4">
        <div className="w-20 h-20 rounded-2xl bg-[#C7FF00]/10 flex items-center justify-center mb-5">
          <Mail className="w-10 h-10 text-[#C7FF00]" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Check your email</h2>
        <p className="text-sm text-gray-400 leading-relaxed max-w-xs">
          We sent a verification link to
        </p>
        <p className="text-sm font-semibold text-[#C7FF00] mt-1">{email}</p>
        <p className="text-xs text-gray-500 mt-3 leading-relaxed max-w-xs">
          Click the link in the email to verify your account, then tap the button below to continue.
        </p>
      </div>

      <div className="space-y-3 pt-2">
        <button
          onClick={handleCheckConfirmation}
          disabled={isLoading || checking}
          className="w-full h-14 rounded-2xl bg-[#C7FF00] text-[#0B0E11] font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {(isLoading || checking) ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <CheckCircle className="w-5 h-5" />
              I've Verified My Email
            </>
          )}
        </button>

        <button
          onClick={handleResend}
          disabled={resendCooldown > 0}
          className="w-full h-12 rounded-2xl bg-white/5 border border-white/10 text-white/70 font-medium text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40"
        >
          {resendCooldown > 0 ? (
            `Resend in ${resendCooldown}s`
          ) : (
            <>
              <Mail className="w-4 h-4" />
              Resend Confirmation Email
            </>
          )}
        </button>
      </div>

      <div className="text-center pt-2">
        <p className="text-[11px] text-gray-600">
          Didn't receive it? Check your spam folder or try resending.
        </p>
      </div>
    </motion.div>
  );
}

// ============================================================================
// STEP 2: IDENTITY INFO (DOB + ID Type)
// ============================================================================

function StepIdentityInfo({ formData, updateForm, onNext }: {
  formData: SignUpData;
  updateForm: (u: Partial<SignUpData>) => void;
  onNext: () => void;
}) {
  const countryCode = formData.selectedCountry?.code ?? 'DEFAULT';
  const idTypes = ID_TYPES_BY_COUNTRY[countryCode] || ID_TYPES_BY_COUNTRY.DEFAULT;

  const isValid = formData.dateOfBirth && formData.idType && formData.idNumber;

  // DOB input handler - format as DD-MM-YYYY
  const handleDobChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/[^0-9-]/g, '');
    // Auto-format: add dashes
    const digits = val.replace(/-/g, '');
    if (digits.length >= 4) {
      val = digits.slice(0, 2) + '-' + digits.slice(2, 4) + '-' + digits.slice(4, 8);
    } else if (digits.length >= 2) {
      val = digits.slice(0, 2) + '-' + digits.slice(2);
    }
    updateForm({ dateOfBirth: val });
  };

  return (
    <div className="px-6 pb-8">
      <div className="text-center mb-6 pt-4">
        <div className="w-16 h-16 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <CreditCard className="w-8 h-8 text-[#C7FF00]" />
        </div>
        <h2 className="text-xl font-bold mb-1">Identity Details</h2>
        <p className="text-sm text-gray-400">
          Required for verification. Must match your ID document.
        </p>
      </div>

      <div className="space-y-4">
        {/* Date of Birth */}
        <FormInput
          label="Date of Birth"
          icon={Calendar}
          value={formData.dateOfBirth}
          onChange={handleDobChange}
          placeholder="DD-MM-YYYY"
          maxLength={10}
        />

        {/* ID Type */}
        <div>
          <label className="block text-xs text-gray-400 uppercase tracking-[0.15em] font-semibold mb-2">
            ID Document Type
          </label>
          <div className="space-y-2">
            {idTypes.map((idType: { value: string; label: string }) => (
              <button
                key={idType.value}
                onClick={() => updateForm({ idType: idType.value as any })}
                className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-all text-left ${
                  formData.idType === idType.value
                    ? 'bg-[#C7FF00]/10 border-[#C7FF00]/50 text-white'
                    : 'bg-white/[0.04] border-white/[0.08] text-gray-300 hover:border-white/20'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  formData.idType === idType.value ? 'border-[#C7FF00]' : 'border-gray-600'
                }`}>
                  {formData.idType === idType.value && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#C7FF00]" />
                  )}
                </div>
                <span className="text-sm font-medium">{idType.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ID Number */}
        <FormInput
          label="ID Number"
          icon={Hash}
          value={formData.idNumber}
          onChange={(e) => updateForm({ idNumber: e.target.value })}
          placeholder="Enter your ID number"
        />

        {/* Next */}
        <motion.button
          onClick={onNext}
          disabled={!isValid}
          whileTap={{ scale: 0.98 }}
          className="w-full bg-[#C7FF00] text-black py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[#D4FF33] disabled:opacity-30 disabled:cursor-not-allowed mt-4"
        >
          Continue to Verification <ArrowRight className="w-4 h-4" />
        </motion.button>
      </div>
    </div>
  );
}

// ============================================================================
// STEP 3: SMILE ID VERIFICATION
// ============================================================================

function StepSmileID({ formData, userId, onComplete, onSkip }: {
  formData: SignUpData;
  userId: string;
  onComplete: (status: 'verified' | 'failed' | 'pending') => void;
  onSkip: () => void;
}) {
  return (
    <KYCVerification
      userId={userId}
      userEmail={formData.email}
      onBack={onSkip}
      onComplete={() => onComplete('verified')}
    />
  );
}


// ============================================================================
// STEP 4: ADDRESS DETAILS
// ============================================================================

function StepAddress({ formData, updateForm, onNext }: {
  formData: SignUpData;
  updateForm: (u: Partial<SignUpData>) => void;
  onNext: () => void;
}) {
  const isValid = formData.street && formData.city && formData.state && formData.postalCode;

  return (
    <div className="px-6 pb-8">
      <div className="text-center mb-6 pt-4">
        <div className="w-16 h-16 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <MapPin className="w-8 h-8 text-[#C7FF00]" />
        </div>
        <h2 className="text-xl font-bold mb-1">Your Address</h2>
        <p className="text-sm text-gray-400">
          Residential address as it appears on your proof of address document.
        </p>
      </div>

      <div className="space-y-3.5">
        <FormInput
          label="Street Address"
          icon={Home}
          value={formData.street}
          onChange={(e) => updateForm({ street: e.target.value })}
          placeholder="123 Main Street"
        />

        <FormInput
          label="Street Address Line 2 (Optional)"
          icon={Building}
          value={formData.street2}
          onChange={(e) => updateForm({ street2: e.target.value })}
          placeholder="Apartment, suite, etc."
        />

        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="City"
            icon={MapPin}
            value={formData.city}
            onChange={(e) => updateForm({ city: e.target.value })}
            placeholder="Lagos"
          />
          <FormInput
            label="State / Province"
            icon={Globe}
            value={formData.state}
            onChange={(e) => updateForm({ state: e.target.value })}
            placeholder="Lagos"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="Postal Code"
            icon={Hash}
            value={formData.postalCode}
            onChange={(e) => updateForm({ postalCode: e.target.value })}
            placeholder="100001"
          />
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-[0.15em] font-semibold mb-2">
              Country
            </label>
            <div className="flex items-center gap-2 py-3.5 px-4 bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl">
              <span className="text-lg">{formData.selectedCountry?.flag}</span>
              <span className="text-sm text-gray-300">{formData.selectedCountry?.name}</span>
            </div>
          </div>
        </div>

        <motion.button
          onClick={onNext}
          disabled={!isValid}
          whileTap={{ scale: 0.98 }}
          className="w-full bg-[#C7FF00] text-black py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[#D4FF33] disabled:opacity-30 disabled:cursor-not-allowed mt-4"
        >
          Continue <ArrowRight className="w-4 h-4" />
        </motion.button>
      </div>
    </div>
  );
}

// ============================================================================
// STEP 5: PROOF OF ADDRESS
// ============================================================================

function StepProofOfAddress({ formData, updateForm, onUpload, isLoading }: {
  formData: SignUpData;
  updateForm: (u: Partial<SignUpData>) => void;
  onUpload: () => void;
  isLoading: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        toast.error('File size must be less than 10MB');
        return;
      }
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      if (!allowedTypes.includes(file.type)) {
        toast.error('Accepted formats: JPG, PNG, WebP, PDF');
        return;
      }
      updateForm({ poaFile: file });
    }
  };

  const isValid = formData.poaDocumentType && formData.poaFile;

  return (
    <div className="px-6 pb-8">
      <div className="text-center mb-6 pt-4">
        <div className="w-16 h-16 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <FileText className="w-8 h-8 text-[#C7FF00]" />
        </div>
        <h2 className="text-xl font-bold mb-1">Proof of Address</h2>
        <p className="text-sm text-gray-400 max-w-xs mx-auto">
          Upload a document confirming your residential address. Must be less than 3 months old.
        </p>
      </div>

      <div className="space-y-4">
        {/* Document Type Selection */}
        <div>
          <label className="block text-xs text-gray-400 uppercase tracking-[0.15em] font-semibold mb-2">
            Document Type
          </label>
          <div className="space-y-2">
            {POA_DOCUMENT_TYPES.map((docType) => (
              <button
                key={docType.value}
                onClick={() => updateForm({ poaDocumentType: docType.value as any })}
                className={`w-full flex items-start gap-3 p-3.5 rounded-2xl border transition-all text-left ${
                  formData.poaDocumentType === docType.value
                    ? 'bg-[#C7FF00]/10 border-[#C7FF00]/50'
                    : 'bg-white/[0.04] border-white/[0.08] hover:border-white/20'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  formData.poaDocumentType === docType.value ? 'border-[#C7FF00]' : 'border-gray-600'
                }`}>
                  {formData.poaDocumentType === docType.value && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#C7FF00]" />
                  )}
                </div>
                <div>
                  <span className="text-sm font-medium text-white">{docType.label}</span>
                  <p className="text-[10px] text-gray-500 mt-0.5">{docType.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* File Upload */}
        <div>
          <label className="block text-xs text-gray-400 uppercase tracking-[0.15em] font-semibold mb-2">
            Upload Document
          </label>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
          />

          {formData.poaFile ? (
            <div className="bg-white/[0.04] backdrop-blur-md border border-[#C7FF00]/30 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-[#C7FF00]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-5 h-5 text-[#C7FF00]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{formData.poaFile.name}</p>
                <p className="text-xs text-gray-500">{(formData.poaFile.size / 1024).toFixed(0)} KB</p>
              </div>
              <button
                onClick={() => { updateForm({ poaFile: null }); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-white/10 rounded-2xl p-6 text-center hover:border-[#C7FF00]/30 transition-all"
            >
              <Upload className="w-8 h-8 text-gray-500 mx-auto mb-2" />
              <p className="text-sm text-gray-300 font-medium">Tap to upload</p>
              <p className="text-xs text-gray-500 mt-1">JPG, PNG, WebP, or PDF (max 10MB)</p>
            </button>
          )}
        </div>

        {/* Upload Button */}
        <motion.button
          onClick={onUpload}
          disabled={!isValid || isLoading}
          whileTap={{ scale: 0.98 }}
          className="w-full bg-[#C7FF00] text-black py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[#D4FF33] disabled:opacity-30 disabled:cursor-not-allowed mt-2"
        >
          {isLoading ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Uploading...</>
          ) : (
            <>Upload & Continue <ArrowRight className="w-4 h-4" /></>
          )}
        </motion.button>
      </div>
    </div>
  );
}

// ============================================================================
// STEP 6: REVIEW & SUBMIT
// ============================================================================

function StepReview({ formData, onSubmit, isLoading }: {
  formData: SignUpData;
  onSubmit: () => void;
  isLoading: boolean;
}) {
  const ReviewRow = ({ label, value, icon: Icon }: { label: string; value: string; icon: any }) => (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0">
      <Icon className="w-4 h-4 text-[#C7FF00] flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
        <p className="text-sm text-white font-medium truncate">{value}</p>
      </div>
    </div>
  );

  return (
    <div className="px-6 pb-8">
      <div className="text-center mb-6 pt-4">
        <div className="w-16 h-16 bg-[#C7FF00]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-[#C7FF00]" />
        </div>
        <h2 className="text-xl font-bold mb-1">Review & Submit</h2>
        <p className="text-sm text-gray-400">
          Please verify your details before submitting.
        </p>
      </div>

      <div className="bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl p-4 mb-4">
        <h3 className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Personal</h3>
        <ReviewRow label="Full Name" value={formData.fullName} icon={User} />
        <ReviewRow label="Email" value={formData.email} icon={Mail} />
        <ReviewRow label="Phone" value={`${formData.selectedCountry?.dialCode}${formData.phone}`} icon={Phone} />
        <ReviewRow label="Country" value={`${formData.selectedCountry?.flag} ${formData.selectedCountry?.name}`} icon={Globe} />
        <ReviewRow label="Date of Birth" value={formData.dateOfBirth} icon={Calendar} />
      </div>

      <div className="bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl p-4 mb-4">
        <h3 className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Identity</h3>
        <ReviewRow label="ID Type" value={formData.idType} icon={CreditCard} />
        <ReviewRow label="ID Number" value={formData.idNumber.replace(/(.{4})/g, '$1 ').trim()} icon={Hash} />
        <ReviewRow 
          label="SmileID Verification" 
          value={
            formData.smileIdStatus === 'verified' ? 'Verified' 
            : formData.smileIdStatus === 'pending' ? 'Processing...' 
            : 'Not started'
          } 
          icon={Shield} 
        />
      </div>

      <div className="bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl p-4 mb-4">
        <h3 className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Address</h3>
        <ReviewRow label="Street" value={formData.street + (formData.street2 ? `, ${formData.street2}` : '')} icon={Home} />
        <ReviewRow label="City" value={formData.city} icon={MapPin} />
        <ReviewRow label="State" value={formData.state} icon={Globe} />
        <ReviewRow label="Postal Code" value={formData.postalCode} icon={Hash} />
        <ReviewRow 
          label="Proof of Address" 
          value={formData.poaUploaded ? `${formData.poaDocumentType?.replace(/_/g, ' ')} - uploaded` : 'Not uploaded'} 
          icon={FileText} 
        />
      </div>

      {/* Warning */}
      <div className="bg-[#C7FF00]/5 border border-[#C7FF00]/20 rounded-2xl p-3 mb-4 flex items-start gap-2.5">
        <AlertCircle className="w-4 h-4 text-[#C7FF00] flex-shrink-0 mt-0.5" />
        <p className="text-xs text-gray-300 leading-relaxed">
          By submitting, you confirm that all information is accurate and matches your official documents. 
          False information may result in account suspension.
        </p>
      </div>

      <motion.button
        onClick={onSubmit}
        disabled={isLoading}
        whileTap={{ scale: 0.98 }}
        className="w-full bg-[#C7FF00] text-black py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#D4FF33] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <><Loader2 className="w-5 h-5 animate-spin" /> Submitting...</>
        ) : (
          <>Submit Application <ArrowRight className="w-4 h-4" /></>
        )}
      </motion.button>
    </div>
  );
}

// ============================================================================
// STEP 7: PENDING
// ============================================================================

function StepPending({ onProceed, enrollmentComplete }: {
  onProceed: () => void;
  enrollmentComplete: boolean;
}) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 pb-8">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-center max-w-sm"
      >
        {/* Animated clock/check icon */}
        <div className="relative w-24 h-24 mx-auto mb-8">
          <motion.div
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
            className="absolute inset-0 rounded-full border-2 border-dashed border-[#C7FF00]/20"
          />
          <div className="absolute inset-2 bg-[#C7FF00]/10 rounded-full flex items-center justify-center">
            {enrollmentComplete ? (
              <CheckCircle className="w-10 h-10 text-[#C7FF00]" />
            ) : (
              <Clock className="w-10 h-10 text-[#C7FF00]" />
            )}
          </div>
        </div>

        <h2 className="text-2xl font-bold text-white mb-3">
          {enrollmentComplete ? 'Application Submitted!' : 'Almost There!'}
        </h2>
        
        <p className="text-gray-400 text-sm mb-6 leading-relaxed">
          {enrollmentComplete
            ? 'Your account is under review. You can explore the dashboard while we verify your details. You\'ll be notified once approved.'
            : 'Your information has been submitted. You can start exploring BorderPay while we process your verification.'
          }
        </p>

        {/* Status cards */}
        <div className="space-y-2.5 mb-8">
          <StatusCard
            icon={<User className="w-4 h-4" />}
            label="Account Created"
            status="done"
          />
          <StatusCard
            icon={<Shield className="w-4 h-4" />}
            label="Identity Verification"
            status="processing"
          />
          <StatusCard
            icon={<FileText className="w-4 h-4" />}
            label="Proof of Address"
            status="processing"
          />
          <StatusCard
            icon={<Lock className="w-4 h-4" />}
            label="2FA, PIN & Biometrics"
            status="locked"
            note="Available after approval"
          />
        </div>

        <motion.button
          onClick={onProceed}
          whileTap={{ scale: 0.98 }}
          className="w-full bg-[#C7FF00] text-black py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#D4FF33]"
        >
          Go to Dashboard <ArrowRight className="w-4 h-4" />
        </motion.button>

        <p className="text-[10px] text-gray-600 mt-4">
          Review typically takes 1-2 business days
        </p>
      </motion.div>
    </div>
  );
}

function StatusCard({ icon, label, status, note }: {
  icon: React.ReactNode;
  label: string;
  status: 'done' | 'processing' | 'locked';
  note?: string;
}) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border ${
      status === 'done' ? 'bg-[#C7FF00]/5 border-[#C7FF00]/20' 
      : status === 'processing' ? 'bg-yellow-500/5 border-yellow-500/20' 
      : 'bg-white/[0.02] border-white/5'
    }`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
        status === 'done' ? 'bg-[#C7FF00]/10 text-[#C7FF00]' 
        : status === 'processing' ? 'bg-yellow-500/10 text-yellow-500' 
        : 'bg-white/5 text-gray-600'
      }`}>
        {icon}
      </div>
      <div className="flex-1 text-left">
        <p className={`text-xs font-semibold ${status === 'locked' ? 'text-gray-500' : 'text-white'}`}>
          {label}
        </p>
        {note && <p className="text-[10px] text-gray-600">{note}</p>}
      </div>
      <div>
        {status === 'done' && <CheckCircle className="w-4 h-4 text-[#C7FF00]" />}
        {status === 'processing' && <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />}
        {status === 'locked' && <Lock className="w-4 h-4 text-gray-600" />}
      </div>
    </div>
  );
}