/**
 * BorderPay Africa – Create Counterparty
 * Multi-step wizard to register a payment recipient for a USD virtual account.
 * Steps: 1) Type  2) Info  3) Beneficiary Address  4) Bank Details  5) Institution Address  6) Review + PIN
 * Full Banking API spec compliance.
 * i18n + theme-aware, neon green (#C7FF00) + black aesthetic.
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, ArrowRight, User, Building2, MapPin, Landmark,
  CheckCircle, Loader2, AlertCircle, ShieldCheck, ChevronDown,
  Phone, Mail, FileText, Globe, Hash, CreditCard, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { usPaymentsAPI as counterpartyAPI } from '../../utils/api/backendAPI';
import { authAPI } from '../../utils/supabase/client';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { PINVerify } from '../auth/PINVerify';
import {
  isCountryRestricted,
  getRestrictionReason,
} from '../../utils/compliance/restrictedJurisdictions';

/* ──────────────────────────── Types ──────────────────────────── */

type AccountType = 'SAVINGS' | 'CHECKING';
type PaymentRail = 'ACH' | 'FEDWIRE';

interface Address {
  unit_number: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

interface FormData {
  // Step 1 – Type
  is_corporate: boolean;
  // Step 2 – Info
  first_name: string;
  last_name: string;
  business_name: string;
  email: string;
  phone_number: string;
  description: string;
  // Step 3 – Beneficiary Address
  beneficiary_address: Address;
  // Step 4 – Bank Details
  account_name: string;
  account_number: string;
  account_type: AccountType;
  payment_rails: PaymentRail[];
  routing_number: string;
  swift_code: string;
  institution_name: string;
  // Step 5 – Institution Address
  include_institution_address: boolean;
  institution_address: Address;
}

const EMPTY_ADDRESS: Address = {
  unit_number: '',
  street: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',
};

const INITIAL_FORM: FormData = {
  is_corporate: false,
  first_name: '',
  last_name: '',
  business_name: '',
  email: '',
  phone_number: '',
  description: '',
  beneficiary_address: { ...EMPTY_ADDRESS },
  account_name: '',
  account_number: '',
  account_type: 'SAVINGS',
  payment_rails: ['ACH'],
  routing_number: '',
  swift_code: '',
  institution_name: '',
  include_institution_address: false,
  institution_address: { ...EMPTY_ADDRESS },
};

const STEPS = ['type', 'info', 'address', 'bank', 'institution', 'review'] as const;
type Step = typeof STEPS[number];

/* ──────────────────────────── Props ──────────────────────────── */

interface CreateCounterpartyScreenProps {
  userId: string;
  onBack: () => void;
  accountId?: string; // Pre-filled USD account ID if known
  onSuccess?: (counterpartyId: string) => void;
}

/* ──────────────────────────── Component ──────────────────────── */

export function CreateCounterpartyScreen({
  userId,
  onBack,
  accountId: prefilledAccountId,
  onSuccess,
}: CreateCounterpartyScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  const [step, setStep] = useState<Step>('type');
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [accountId, setAccountId] = useState(prefilledAccountId || '');
  const [submitting, setSubmitting] = useState(false);
  const [showPIN, setShowPIN] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [success, setSuccess] = useState(false);
  const [createdId, setCreatedId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const stepIndex = STEPS.indexOf(step);
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  // ─── Step labels ─────────────────────────────────────────────────
  const stepLabels: Record<Step, string> = {
    type: t('cp.step.type'),
    info: t('cp.step.info'),
    address: t('cp.step.address'),
    bank: t('cp.step.bank'),
    institution: t('cp.step.institution'),
    review: t('cp.step.review'),
  };

  // ─── Helpers ─────────────────────────────────────────────────────
  const updateForm = useCallback((updates: Partial<FormData>) => {
    setForm(prev => ({ ...prev, ...updates }));
    // Clear errors for updated fields
    const clearedErrors = { ...errors };
    Object.keys(updates).forEach(k => delete clearedErrors[k]);
    setErrors(clearedErrors);
  }, [errors]);

  const updateAddress = useCallback((
    field: 'beneficiary_address' | 'institution_address',
    key: keyof Address,
    value: string,
  ) => {
    setForm(prev => ({
      ...prev,
      [field]: { ...prev[field], [key]: value },
    }));
    setErrors(prev => {
      const next = { ...prev };
      delete next[`${field}.${key}`];
      return next;
    });
  }, []);

  const toggleRail = (rail: PaymentRail) => {
    setForm(prev => {
      const current = prev.payment_rails;
      if (current.includes(rail)) {
        if (current.length <= 1) return prev; // Must have at least one
        return { ...prev, payment_rails: current.filter(r => r !== rail) };
      }
      return { ...prev, payment_rails: [...current, rail] };
    });
  };

  // ─── Validation per step ─────────────────────────────────────────
  const validateStep = (s: Step): boolean => {
    const e: Record<string, string> = {};

    if (s === 'type') {
      if (!accountId.trim()) e.account_id = t('cp.required');
    }

    if (s === 'info') {
      if (!form.is_corporate) {
        if (!form.first_name.trim()) e.first_name = t('cp.required');
        if (!form.last_name.trim()) e.last_name = t('cp.required');
      } else {
        if (!form.business_name.trim()) e.business_name = t('cp.required');
      }
    }

    if (s === 'address') {
      const a = form.beneficiary_address;
      if (!a.street.trim()) e['beneficiary_address.street'] = t('cp.required');
      if (!a.city.trim()) e['beneficiary_address.city'] = t('cp.required');
      if (!a.state.trim()) e['beneficiary_address.state'] = t('cp.required');
      if (!a.postal_code.trim()) e['beneficiary_address.postal_code'] = t('cp.required');
      if (!a.country.trim()) e['beneficiary_address.country'] = t('cp.required');
      else if (!/^[A-Z]{2}$/.test(a.country.toUpperCase())) e['beneficiary_address.country'] = 'Invalid ISO code';
      else if (isCountryRestricted(a.country.toUpperCase())) e['beneficiary_address.country'] = getRestrictionReason(a.country.toUpperCase());
    }

    if (s === 'bank') {
      if (!form.account_name.trim()) e.account_name = t('cp.required');
      if (!form.account_number.trim()) e.account_number = t('cp.required');
      if (!form.routing_number.trim()) e.routing_number = t('cp.required');
      if (!form.institution_name.trim()) e.institution_name = t('cp.required');
      if (form.payment_rails.length === 0) e.payment_rails = t('cp.required');
    }

    if (s === 'institution' && form.include_institution_address) {
      const a = form.institution_address;
      if (!a.street.trim()) e['institution_address.street'] = t('cp.required');
      if (!a.city.trim()) e['institution_address.city'] = t('cp.required');
      if (!a.state.trim()) e['institution_address.state'] = t('cp.required');
      if (!a.postal_code.trim()) e['institution_address.postal_code'] = t('cp.required');
      if (!a.country.trim()) e['institution_address.country'] = t('cp.required');
      else if (!/^[A-Z]{2}$/.test(a.country.toUpperCase())) e['institution_address.country'] = 'Invalid ISO code';
      else if (isCountryRestricted(a.country.toUpperCase())) e['institution_address.country'] = getRestrictionReason(a.country.toUpperCase());
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };

  const goBack = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
    else onBack();
  };

  // ─── Submit ──────────────────────────────────────────────────────
  const handleSubmit = async (pin: string) => {
    setSubmitting(true);
    try {
      const payload: any = {
        account_id: accountId.trim(),
        is_corporate: form.is_corporate,
        beneficiary_address: {
          ...form.beneficiary_address,
          country: form.beneficiary_address.country.toUpperCase(),
        },
        account_information: {
          account_name: form.account_name.trim(),
          account_number: form.account_number.trim(),
          type: form.account_type,
          payment_rails: form.payment_rails,
          routing_number: form.routing_number.trim(),
          swift_code: form.swift_code.trim() || undefined,
          institution_name: form.institution_name.trim(),
        },
        transaction_pin: pin,
      };

      // Optional fields
      if (form.email.trim()) payload.email = form.email.trim();
      if (form.description.trim()) payload.description = form.description.trim();
      if (form.phone_number.trim()) payload.phone_number = form.phone_number.trim();

      if (form.is_corporate) {
        payload.business_name = form.business_name.trim();
      } else {
        payload.first_name = form.first_name.trim();
        payload.last_name = form.last_name.trim();
      }

      if (form.include_institution_address) {
        payload.institution_address = {
          ...form.institution_address,
          country: form.institution_address.country.toUpperCase(),
        };
      }

      console.log('[CreateCounterparty] Submitting:', JSON.stringify(payload).slice(0, 300));

      const result = await counterpartyAPI.createCounterparty(payload);

      if (result?.success) {
        const cpId = result.data?.counterparty_id || '';
        setCreatedId(cpId);
        setSuccess(true);
        toast.success(t('cp.success'));
        onSuccess?.(cpId);
      } else {
        throw new Error(result?.error || t('cp.error'));
      }
    } catch (err: any) {
      console.error('[CreateCounterparty] Error:', err);
      toast.error(err.message || t('cp.error'));
      setShowPIN(false);
    } finally {
      setSubmitting(false);
    }
  };

  // ─── PIN flow ────────────────────────────────────────────────────
  if (showPIN && !success) {
    return (
      <PINVerify
        onVerifySuccess={() => handleSubmit(pinValue)}
        onCancel={() => setShowPIN(false)}
        transactionType="Create Counterparty"
      />
    );
  }

  // ─── Success screen ──────────────────────────────────────────────
  if (success) {
    return (
      <div className={`min-h-screen ${tc.bg} flex items-center justify-center px-6`}>
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center max-w-sm"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.4, ease: 'easeOut', delay: 0.1 }}
            className="w-20 h-20 bg-[#C7FF00]/20 rounded-full flex items-center justify-center mx-auto mb-6"
          >
            <CheckCircle className="w-10 h-10 text-[#C7FF00]" />
          </motion.div>
          <h2 className={`text-xl font-black ${tc.text} mb-2`}>{t('cp.success')}</h2>
          <p className={`text-sm ${tc.textSecondary} mb-8`}>{t('cp.successDesc')}</p>

          {createdId && (
            <div className={`${tc.isLight ? 'bg-gray-50' : 'bg-white/5'} rounded-xl p-3 mb-6`}>
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Counterparty ID</p>
              <p className={`text-xs font-mono ${tc.text} break-all`}>{createdId}</p>
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={() => {
                setSuccess(false);
                setForm(INITIAL_FORM);
                setStep('type');
                setCreatedId('');
              }}
              className="w-full py-3.5 bg-[#C7FF00] text-black font-bold rounded-xl hover:bg-[#B8F000] transition-colors"
            >
              {t('cp.addAnother')}
            </button>
            <button
              onClick={onBack}
              className={`w-full py-3.5 ${tc.isLight ? 'bg-gray-100 text-gray-700' : 'bg-white/10 text-white'} font-bold rounded-xl transition-colors`}
            >
              {t('cp.back')}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ─── Shared input component ───���──────────────────────────────────
  const Input = ({
    label,
    value,
    onChange,
    placeholder,
    errorKey,
    required,
    type = 'text',
    icon: Icon,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    errorKey?: string;
    required?: boolean;
    type?: string;
    icon?: any;
  }) => (
    <div className="mb-4">
      <label className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-wide flex items-center gap-1 mb-1.5`}>
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        )}
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full ${Icon ? 'pl-10' : 'pl-4'} pr-4 py-3 rounded-xl text-sm font-medium transition-all outline-none
            ${tc.isLight
              ? 'bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-[#C7FF00] focus:ring-1 focus:ring-[#C7FF00]/30'
              : 'bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:border-[#C7FF00] focus:ring-1 focus:ring-[#C7FF00]/30'
            }
            ${errorKey && errors[errorKey] ? 'border-red-500/50 ring-1 ring-red-500/20' : ''}
          `}
        />
      </div>
      {errorKey && errors[errorKey] && (
        <p className="text-red-400 text-[10px] mt-1 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {errors[errorKey]}
        </p>
      )}
    </div>
  );

  // ─── Address fields component ────────────────────────────────────
  const AddressFields = ({
    prefix,
    address,
    onUpdate,
  }: {
    prefix: 'beneficiary_address' | 'institution_address';
    address: Address;
    onUpdate: (key: keyof Address, val: string) => void;
  }) => (
    <>
      <Input label={t('cp.unitNumber')} value={address.unit_number} onChange={v => onUpdate('unit_number', v)} placeholder="21" errorKey={`${prefix}.unit_number`} icon={Hash} />
      <Input label={t('cp.street')} value={address.street} onChange={v => onUpdate('street', v)} placeholder="Adeniyi Jones" required errorKey={`${prefix}.street`} icon={MapPin} />
      <div className="grid grid-cols-2 gap-3">
        <Input label={t('cp.city')} value={address.city} onChange={v => onUpdate('city', v)} placeholder="Ikeja" required errorKey={`${prefix}.city`} />
        <Input label={t('cp.state')} value={address.state} onChange={v => onUpdate('state', v)} placeholder="Lagos" required errorKey={`${prefix}.state`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label={t('cp.postalCode')} value={address.postal_code} onChange={v => onUpdate('postal_code', v)} placeholder="210422" required errorKey={`${prefix}.postal_code`} />
        <Input label={t('cp.country')} value={address.country} onChange={v => onUpdate('country', v.toUpperCase())} placeholder={t('cp.countryPlaceholder')} required errorKey={`${prefix}.country`} icon={Globe} />
      </div>
    </>
  );

  // ─── Step content ──���─────────────────────────────────────────────
  const renderStep = () => {
    switch (step) {
      // ── Step 1: Type ────────────────────────────────────────────
      case 'type':
        return (
          <div className="space-y-5">
            {/* Account ID */}
            <Input
              label={t('cp.selectAccount')}
              value={accountId}
              onChange={v => { setAccountId(v); setErrors(prev => { const n = {...prev}; delete n.account_id; return n; }); }}
              placeholder="acc_xxxxxxxx"
              required
              errorKey="account_id"
              icon={CreditCard}
            />

            {/* Type toggle */}
            <div>
              <label className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-wide mb-3 block`}>
                {t('cp.recipientType')}
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: false, label: t('cp.individual'), desc: t('cp.individualDesc'), icon: User },
                  { value: true, label: t('cp.corporate'), desc: t('cp.corporateDesc'), icon: Building2 },
                ].map(opt => {
                  const selected = form.is_corporate === opt.value;
                  const Icon = opt.icon;
                  return (
                    <motion.button
                      key={String(opt.value)}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => updateForm({ is_corporate: opt.value as boolean })}
                      className={`p-4 rounded-2xl border-2 text-left transition-all ${
                        selected
                          ? 'border-[#C7FF00] bg-[#C7FF00]/10'
                          : tc.isLight
                            ? 'border-gray-200 bg-gray-50 hover:border-gray-300'
                            : 'border-white/10 bg-white/5 hover:border-white/20'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 ${
                        selected ? 'bg-[#C7FF00]/20' : tc.isLight ? 'bg-gray-200' : 'bg-white/10'
                      }`}>
                        <Icon className={`w-5 h-5 ${selected ? 'text-[#C7FF00]' : 'text-gray-400'}`} />
                      </div>
                      <p className={`text-sm font-bold ${selected ? 'text-[#C7FF00]' : tc.text}`}>{opt.label}</p>
                      <p className={`text-[10px] mt-1 ${tc.textSecondary}`}>{opt.desc}</p>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </div>
        );

      // ── Step 2: Info ────────────────────────────────────────────
      case 'info':
        return (
          <div className="space-y-1">
            {!form.is_corporate ? (
              <>
                <Input label={t('cp.firstName')} value={form.first_name} onChange={v => updateForm({ first_name: v })} placeholder="John" required errorKey="first_name" icon={User} />
                <Input label={t('cp.lastName')} value={form.last_name} onChange={v => updateForm({ last_name: v })} placeholder="Doe" required errorKey="last_name" icon={User} />
              </>
            ) : (
              <Input label={t('cp.businessName')} value={form.business_name} onChange={v => updateForm({ business_name: v })} placeholder="Acme Corp" required errorKey="business_name" icon={Building2} />
            )}
            <Input label={t('cp.email')} value={form.email} onChange={v => updateForm({ email: v })} placeholder="johndoe@testmail.com" type="email" icon={Mail} />
            <Input label={t('cp.phone')} value={form.phone_number} onChange={v => updateForm({ phone_number: v })} placeholder={t('cp.phonePlaceholder')} type="tel" icon={Phone} />
            <Input label={t('cp.description')} value={form.description} onChange={v => updateForm({ description: v })} placeholder={t('cp.descriptionPlaceholder')} icon={FileText} />
          </div>
        );

      // ── Step 3: Beneficiary Address ─────────────────────────────
      case 'address':
        return (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-[#C7FF00]" />
              <h3 className={`text-sm font-bold ${tc.text}`}>{t('cp.beneficiaryAddress')}</h3>
            </div>
            <AddressFields
              prefix="beneficiary_address"
              address={form.beneficiary_address}
              onUpdate={(key, val) => updateAddress('beneficiary_address', key, val)}
            />
          </div>
        );

      // ── Step 4: Bank Details ────────────────────────────────────
      case 'bank':
        return (
          <div className="space-y-1">
            <Input label={t('cp.accountName')} value={form.account_name} onChange={v => updateForm({ account_name: v })} placeholder="John Doe" required errorKey="account_name" icon={User} />
            <Input label={t('cp.accountNumber')} value={form.account_number} onChange={v => updateForm({ account_number: v })} placeholder="1234567890" required errorKey="account_number" icon={Hash} />

            {/* Account Type */}
            <div className="mb-4">
              <label className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-wide mb-1.5 block`}>
                {t('cp.accountType')} <span className="text-red-400">*</span>
              </label>
              <div className="flex gap-2">
                {(['SAVINGS', 'CHECKING'] as AccountType[]).map(at => (
                  <button
                    key={at}
                    onClick={() => updateForm({ account_type: at })}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
                      form.account_type === at
                        ? 'bg-[#C7FF00] text-black'
                        : tc.isLight
                          ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          : 'bg-white/5 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    {at === 'SAVINGS' ? t('cp.savings') : t('cp.checking')}
                  </button>
                ))}
              </div>
            </div>

            {/* Payment Rails */}
            <div className="mb-4">
              <label className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-wide mb-1.5 block`}>
                {t('cp.paymentRails')} <span className="text-red-400">*</span>
              </label>
              <div className="flex gap-2">
                {(['ACH', 'FEDWIRE'] as PaymentRail[]).map(rail => (
                  <button
                    key={rail}
                    onClick={() => toggleRail(rail)}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
                      form.payment_rails.includes(rail)
                        ? 'bg-[#C7FF00] text-black'
                        : tc.isLight
                          ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          : 'bg-white/5 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    {rail}
                  </button>
                ))}
              </div>
              {errors.payment_rails && (
                <p className="text-red-400 text-[10px] mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errors.payment_rails}
                </p>
              )}
            </div>

            <Input label={t('cp.routingNumber')} value={form.routing_number} onChange={v => updateForm({ routing_number: v })} placeholder="021000021" required errorKey="routing_number" icon={Hash} />
            <Input label={t('cp.swiftCode')} value={form.swift_code} onChange={v => updateForm({ swift_code: v })} placeholder={t('cp.swiftPlaceholder')} icon={Globe} />
            <Input label={t('cp.institutionName')} value={form.institution_name} onChange={v => updateForm({ institution_name: v })} placeholder={t('cp.institutionPlaceholder')} required errorKey="institution_name" icon={Landmark} />
          </div>
        );

      // ── Step 5: Institution Address (optional) ──────────────────
      case 'institution':
        return (
          <div>
            {/* Toggle */}
            <button
              onClick={() => updateForm({ include_institution_address: !form.include_institution_address })}
              className={`w-full flex items-center justify-between p-4 rounded-2xl border mb-4 transition-all ${
                form.include_institution_address
                  ? 'border-[#C7FF00] bg-[#C7FF00]/10'
                  : tc.isLight
                    ? 'border-gray-200 bg-gray-50'
                    : 'border-white/10 bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <Landmark className={`w-5 h-5 ${form.include_institution_address ? 'text-[#C7FF00]' : 'text-gray-400'}`} />
                <span className={`text-sm font-medium ${tc.text}`}>{t('cp.includeInstitutionAddr')}</span>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                form.include_institution_address
                  ? 'border-[#C7FF00] bg-[#C7FF00]'
                  : tc.isLight ? 'border-gray-300' : 'border-white/20'
              }`}>
                {form.include_institution_address && (
                  <CheckCircle className="w-3 h-3 text-black" />
                )}
              </div>
            </button>

            {form.include_institution_address && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <Landmark className="w-4 h-4 text-[#C7FF00]" />
                  <h3 className={`text-sm font-bold ${tc.text}`}>{t('cp.institutionAddress')}</h3>
                </div>
                <AddressFields
                  prefix="institution_address"
                  address={form.institution_address}
                  onUpdate={(key, val) => updateAddress('institution_address', key, val)}
                />
              </motion.div>
            )}

            {!form.include_institution_address && (
              <div className={`text-center py-8 ${tc.textSecondary}`}>
                <Landmark className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Institution address is optional.</p>
                <p className="text-xs mt-1 opacity-60">You can skip this step and proceed to review.</p>
              </div>
            )}
          </div>
        );

      // ── Step 6: Review ──────────────────────────────────────────
      case 'review':
        const displayName = form.is_corporate
          ? form.business_name
          : `${form.first_name} ${form.last_name}`;

        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-[#C7FF00]" />
              <h3 className={`text-sm font-bold ${tc.text}`}>{t('cp.reviewTitle')}</h3>
            </div>

            {/* Review cards */}
            {[
              {
                title: t('cp.recipientType'),
                items: [
                  [t('cp.recipientType'), form.is_corporate ? t('cp.corporate') : t('cp.individual')],
                  [t('cp.recipientName'), displayName],
                  ...(form.email ? [[t('cp.email'), form.email]] : []),
                  ...(form.phone_number ? [[t('cp.phone'), form.phone_number]] : []),
                  ...(form.description ? [[t('cp.description'), form.description]] : []),
                ],
              },
              {
                title: t('cp.beneficiaryAddress'),
                items: [
                  [t('cp.street'), `${form.beneficiary_address.unit_number ? form.beneficiary_address.unit_number + ', ' : ''}${form.beneficiary_address.street}`],
                  [t('cp.city'), form.beneficiary_address.city],
                  [t('cp.state'), form.beneficiary_address.state],
                  [t('cp.postalCode'), form.beneficiary_address.postal_code],
                  [t('cp.country'), form.beneficiary_address.country],
                ],
              },
              {
                title: t('cp.bankInfo'),
                items: [
                  [t('cp.accountName'), form.account_name],
                  [t('cp.acctEnding'), `****${form.account_number.slice(-4)}`],
                  [t('cp.accountType'), form.account_type],
                  [t('cp.rails'), form.payment_rails.join(', ')],
                  [t('cp.routingNumber'), form.routing_number],
                  ...(form.swift_code ? [[t('cp.swiftCode'), form.swift_code]] : []),
                  [t('cp.institutionName'), form.institution_name],
                ],
              },
              ...(form.include_institution_address ? [{
                title: t('cp.institutionAddress'),
                items: [
                  [t('cp.street'), `${form.institution_address.unit_number ? form.institution_address.unit_number + ', ' : ''}${form.institution_address.street}`],
                  [t('cp.city'), form.institution_address.city],
                  [t('cp.state'), form.institution_address.state],
                  [t('cp.postalCode'), form.institution_address.postal_code],
                  [t('cp.country'), form.institution_address.country],
                ],
              }] : []),
            ].map((section, si) => (
              <div
                key={si}
                className={`rounded-2xl border p-4 ${tc.isLight ? 'bg-gray-50 border-gray-200' : 'bg-white/5 border-white/10'}`}
              >
                <h4 className={`text-[10px] uppercase tracking-[0.15em] font-bold ${tc.textSecondary} mb-3`}>
                  {section.title}
                </h4>
                <div className="space-y-2">
                  {section.items.map(([label, value], i) => (
                    <div key={i} className="flex justify-between items-center">
                      <span className={`text-xs ${tc.textSecondary}`}>{label}</span>
                      <span className={`text-xs font-semibold ${tc.text} text-right max-w-[55%] truncate`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Account ID */}
            <div className={`rounded-2xl border p-4 ${tc.isLight ? 'bg-gray-50 border-gray-200' : 'bg-white/5 border-white/10'}`}>
              <div className="flex justify-between items-center">
                <span className={`text-xs ${tc.textSecondary}`}>{t('cp.selectAccount')}</span>
                <span className={`text-[10px] font-mono ${tc.text} break-all`}>{accountId}</span>
              </div>
            </div>
          </div>
        );
    }
  };

  // ─── Main render ─────────────────────────────────────────────────
  return (
    <div className={`min-h-screen ${tc.bg}`}>
      {/* ── Header ── */}
      <div className={`sticky top-0 z-30 ${tc.isLight ? 'bg-white/80' : 'bg-[#0B0E11]/80'} backdrop-blur-md border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-5 py-3">
          <button onClick={goBack} className="p-2 -ml-2 rounded-xl hover:bg-white/5 transition-colors">
            <ArrowLeft className={`w-5 h-5 ${tc.text}`} />
          </button>
          <div className="text-center">
            <h1 className={`text-sm font-black ${tc.text}`}>{t('cp.title')}</h1>
            <p className={`text-[10px] ${tc.textSecondary}`}>
              {stepLabels[step]} ({stepIndex + 1}/{STEPS.length})
            </p>
          </div>
          <div className="w-9" />
        </div>

        {/* Progress bar */}
        <div className={`h-1 ${tc.isLight ? 'bg-gray-100' : 'bg-white/5'}`}>
          <motion.div
            className="h-full bg-[#C7FF00]"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* ── Step indicators ── */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => {
            const isActive = i === stepIndex;
            const isComplete = i < stepIndex;
            return (
              <div key={s} className="flex items-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                  isActive
                    ? 'bg-[#C7FF00] text-black'
                    : isComplete
                      ? 'bg-[#C7FF00]/30 text-[#C7FF00]'
                      : tc.isLight
                        ? 'bg-gray-200 text-gray-400'
                        : 'bg-white/10 text-gray-500'
                }`}>
                  {isComplete ? <CheckCircle className="w-3.5 h-3.5" /> : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-4 sm:w-6 h-0.5 mx-0.5 ${
                    isComplete ? 'bg-[#C7FF00]/40' : tc.isLight ? 'bg-gray-200' : 'bg-white/10'
                  }`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="px-5 pt-4 pb-32">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Bottom action bar ── */}
      <div className={`fixed bottom-0 left-0 right-0 ${tc.isLight ? 'bg-white border-gray-200' : 'bg-[#0B0E11] border-white/10'} border-t px-5 py-4 pb-safe z-30`}>
        {step === 'review' ? (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              if (!validateStep('review')) return;
              setShowPIN(true);
            }}
            disabled={submitting}
            className="w-full py-4 bg-[#C7FF00] text-black font-black rounded-xl hover:bg-[#B8F000] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('cp.creating')}
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                {t('cp.submit')}
              </>
            )}
          </motion.button>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={goBack}
              className={`flex-1 py-3.5 ${tc.isLight ? 'bg-gray-100 text-gray-700' : 'bg-white/10 text-white'} font-bold rounded-xl transition-colors`}
            >
              {t('cp.back')}
            </button>
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={goNext}
              className="flex-[2] py-3.5 bg-[#C7FF00] text-black font-bold rounded-xl hover:bg-[#B8F000] transition-colors flex items-center justify-center gap-2"
            >
              {t('cp.next')}
              <ArrowRight className="w-4 h-4" />
            </motion.button>
          </div>
        )}
      </div>
    </div>
  );
}