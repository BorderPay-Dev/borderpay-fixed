/**
 * BorderPay Africa – Mobile Money Collection Screen
 * Full MoMo collection flow with OTP verification.
 *
 * Flow:
 *   1. Select currency → provider → enter phone, amount, description
 *   2. (Optional) counterparty details for compliance
 *   3. PIN verify → submit collection
 *   4. If OTP required → OTP input screen
 *   5. Success / error result
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Smartphone, ChevronDown, CheckCircle, Loader2,
  AlertCircle, Phone, DollarSign, FileText, User, Send,
  ShieldCheck, Hash, RefreshCw, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { friendlyError } from '../../utils/errors/friendlyError';
import { PINVerify } from '../auth/PINVerify';

/* ──────────────── Types ──────────────── */

interface MomoCurrency {
  code: string;
  label: string;
  providerCount: number;
}

interface MomoProvider {
  bank_code: string;
  name: string;
  currency: string;
  country: string;
  icon: string;
}

type FlowStep = 'form' | 'counterparty' | 'review' | 'pin' | 'otp' | 'result';

interface FormState {
  currency: string;
  bank_code: string;
  account_number: string;
  amount: string;
  description: string;
  // counterparty
  cp_first_name: string;
  cp_last_name: string;
  cp_email: string;
  cp_phone: string;
}

const INITIAL_FORM: FormState = {
  currency: '',
  bank_code: '',
  account_number: '',
  amount: '',
  description: '',
  cp_first_name: '',
  cp_last_name: '',
  cp_email: '',
  cp_phone: '',
};

/** Lowest-denomination multipliers per currency */
const DENOM: Record<string, number> = {
  NGN: 100,
  KES: 100,
  GHS: 100,
  UGX: 1,
  XAF: 1,
  XOF: 1,
  TZS: 100,
  SLE: 100,
  MZN: 100,
  MWK: 100,
};

/** Currency flag / symbol */
const CURRENCY_FLAG: Record<string, string> = {
  XAF: '🇨🇲',
  KES: '🇰🇪',
  NGN: '🇳🇬',
  XOF: '🇧🇯',
  TZS: '🇹🇿',
  UGX: '🇺🇬',
  GHS: '🇬🇭',
  SLE: '🇸🇱',
  MZN: '🇲🇿',
  MWK: '🇲🇼',
};

/** Fallback providers used in sandbox when API returns empty */
const FALLBACK_PROVIDERS: MomoProvider[] = [
  { bank_code: 'mpesa_ng', name: 'M-Pesa', currency: 'NGN', country: 'NG', icon: '📱' },
  { bank_code: 'opay_ng', name: 'OPay', currency: 'NGN', country: 'NG', icon: '💚' },
  { bank_code: 'palmpay_ng', name: 'PalmPay', currency: 'NGN', country: 'NG', icon: '🌴' },
  { bank_code: 'airtel_ng', name: 'Airtel', currency: 'NGN', country: 'NG', icon: '🔴' },
  { bank_code: 'mpesa_ke', name: 'M-Pesa', currency: 'KES', country: 'KE', icon: '📱' },
  { bank_code: 'airtel_ke', name: 'Airtel Money', currency: 'KES', country: 'KE', icon: '🔴' },
  { bank_code: 'mtn_gh', name: 'MTN MoMo', currency: 'GHS', country: 'GH', icon: '🟡' },
  { bank_code: 'vodafone_gh', name: 'Vodafone Cash', currency: 'GHS', country: 'GH', icon: '🔴' },
  { bank_code: 'airteltigo_gh', name: 'AirtelTigo', currency: 'GHS', country: 'GH', icon: '🔵' },
  { bank_code: 'mtn_ug', name: 'MTN MoMo', currency: 'UGX', country: 'UG', icon: '🟡' },
  { bank_code: 'airtel_ug', name: 'Airtel Money', currency: 'UGX', country: 'UG', icon: '🔴' },
  { bank_code: 'mpesa_tz', name: 'M-Pesa', currency: 'TZS', country: 'TZ', icon: '📱' },
  { bank_code: 'tigo_tz', name: 'Tigo Pesa', currency: 'TZS', country: 'TZ', icon: '🔵' },
  { bank_code: 'airtel_tz', name: 'Airtel Money', currency: 'TZS', country: 'TZ', icon: '🔴' },
  { bank_code: 'orange_xaf', name: 'Orange Money', currency: 'XAF', country: 'CM', icon: '🟠' },
  { bank_code: 'mtn_xaf', name: 'MTN MoMo', currency: 'XAF', country: 'CM', icon: '🟡' },
  { bank_code: 'orange_xof', name: 'Orange Money', currency: 'XOF', country: 'BJ', icon: '🟠' },
  { bank_code: 'moov_xof', name: 'Moov Money', currency: 'XOF', country: 'BJ', icon: '🟣' },
  { bank_code: 'orange_sle', name: 'Orange Money', currency: 'SLE', country: 'SL', icon: '🟠' },
  { bank_code: 'africell_sle', name: 'Africell Money', currency: 'SLE', country: 'SL', icon: '🔵' },
  { bank_code: 'mpesa_mzn', name: 'M-Pesa', currency: 'MZN', country: 'MZ', icon: '📱' },
  { bank_code: 'emola_mzn', name: 'e-Mola', currency: 'MZN', country: 'MZ', icon: '🟢' },
  { bank_code: 'airtel_mwk', name: 'Airtel Money', currency: 'MWK', country: 'MW', icon: '🔴' },
  { bank_code: 'tnm_mwk', name: 'TNM Mpamba', currency: 'MWK', country: 'MW', icon: '🔵' },
];

/* ──────────────── Props ──────────────── */

interface Props {
  onBack: () => void;
  onComplete?: () => void;
}

export function MomoCollectionScreen({ onBack, onComplete }: Props) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  const [step, setStep] = useState<FlowStep>('form');
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [currencies, setCurrencies] = useState<MomoCurrency[]>([]);
  const [providers, setProviders] = useState<MomoProvider[]>([]);
  const [allProviders, setAllProviders] = useState<MomoProvider[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // OTP state
  const [transactionId, setTransactionId] = useState('');
  const [reference, setReference] = useState('');
  const [otpValue, setOtpValue] = useState('');
  const [otpSubmitting, setOtpSubmitting] = useState(false);

  // Result
  const [resultData, setResultData] = useState<null | {
    success: boolean;
    message: string;
    reference?: string;
    status?: string;
  }>(null);

  const otpInputRef = useRef<HTMLInputElement>(null);

  /* ── Load providers on mount ──────────────────────────────────── */
  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    setLoadingProviders(true);
    try {
      const res = await backendAPI.mobileMoney.getProviders();
      if (res.success && res.data?.data) {
        const apiCurrencies: MomoCurrency[] = res.data.data.currencies || [];
        const apiProviders: MomoProvider[] = res.data.data.providers || [];

        // If API returns empty providers (common in sandbox), use fallback
        const finalProviders = apiProviders.length > 0 ? apiProviders : FALLBACK_PROVIDERS;

        // Build currency list from providers if API currencies are empty
        if (apiCurrencies.length === 0 && finalProviders.length > 0) {
          const seen = new Set<string>();
          const derived: MomoCurrency[] = [];
          finalProviders.forEach(p => {
            if (!seen.has(p.currency)) {
              seen.add(p.currency);
              derived.push({
                code: p.currency,
                label: p.currency,
                providerCount: finalProviders.filter(x => x.currency === p.currency).length,
              });
            }
          });
          setCurrencies(derived);
        } else {
          setCurrencies(apiCurrencies);
        }

        setAllProviders(finalProviders);
      } else {
        // Full fallback when API fails entirely
        const seen = new Set<string>();
        const derived: MomoCurrency[] = [];
        FALLBACK_PROVIDERS.forEach(p => {
          if (!seen.has(p.currency)) {
            seen.add(p.currency);
            derived.push({
              code: p.currency,
              label: p.currency,
              providerCount: FALLBACK_PROVIDERS.filter(x => x.currency === p.currency).length,
            });
          }
        });
        setCurrencies(derived);
        setAllProviders(FALLBACK_PROVIDERS);
      }
    } catch (e) {
      // Use fallback providers
      const seen = new Set<string>();
      const derived: MomoCurrency[] = [];
      FALLBACK_PROVIDERS.forEach(p => {
        if (!seen.has(p.currency)) {
          seen.add(p.currency);
          derived.push({
            code: p.currency,
            label: p.currency,
            providerCount: FALLBACK_PROVIDERS.filter(x => x.currency === p.currency).length,
          });
        }
      });
      setCurrencies(derived);
      setAllProviders(FALLBACK_PROVIDERS);
    } finally {
      setLoadingProviders(false);
    }
  };

  /* ── Filter providers when currency changes ───────────────────── */
  useEffect(() => {
    if (form.currency) {
      const filtered = allProviders.filter(p => p.currency === form.currency);
      setProviders(filtered);
      // Reset bank_code if current selection doesn't match
      if (form.bank_code && !filtered.find(p => p.bank_code === form.bank_code)) {
        updateField('bank_code', '');
      }
    } else {
      setProviders([]);
    }
  }, [form.currency, allProviders]);

  /* ── Field updater ────────────────────────────────────────────── */
  const updateField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  /* ── Validate form step ───────────────────────────────────────── */
  const validateForm = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.currency) e.currency = t('momo.required');
    if (!form.bank_code) e.bank_code = t('momo.required');
    if (!form.account_number) e.account_number = t('momo.required');
    if (!form.amount || parseFloat(form.amount) <= 0) e.amount = t('momo.invalidAmount');
    if (!form.description) e.description = t('momo.required');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateCounterparty = (): boolean => {
    // Counterparty is optional – if any field is filled, validate all
    const hasAny = form.cp_first_name || form.cp_last_name || form.cp_email || form.cp_phone;
    if (!hasAny) return true;

    const e: Record<string, string> = {};
    if (!form.cp_first_name) e.cp_first_name = t('momo.required');
    if (!form.cp_last_name) e.cp_last_name = t('momo.required');
    if (!form.cp_email) e.cp_email = t('momo.required');
    if (!form.cp_phone) e.cp_phone = t('momo.required');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  /* ── Submit collection ────────────────────────────────────────── */
  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const mult = DENOM[form.currency] || 1;
      const amountLowest = Math.round(parseFloat(form.amount) * mult);

      const payload: any = {
        account_number: form.account_number,
        amount: amountLowest,
        bank_code: form.bank_code,
        currency: form.currency,
        description: form.description,
      };

      // Include counterparty if filled
      if (form.cp_first_name && form.cp_last_name) {
        payload.counterparty = {
          first_name: form.cp_first_name,
          last_name: form.cp_last_name,
          email: form.cp_email || undefined,
          phone_number: form.cp_phone || form.account_number,
        };
      }

      const res = await backendAPI.mobileMoney.collect(payload);

      if (res.success && res.data) {
        const data = res.data.data || res.data;
        setTransactionId(data.transaction_id || '');
        setReference(data.reference || '');

        if (data.requires_otp) {
          setStep('otp');
          toast.success(t('momo.otpSent'));
        } else {
          setResultData({
            success: true,
            message: res.data.message || t('momo.collectionInitiated'),
            reference: data.reference,
            status: data.status,
          });
          setStep('result');
        }
      } else {
        toast.error(friendlyError(res.error, t('momo.collectionFailed')));
        setResultData({
          success: false,
          message: res.error || t('momo.collectionFailed'),
        });
        setStep('result');
      }
    } catch (err: any) {
      toast.error(friendlyError(err, t('momo.collectionFailed')));
      setResultData({
        success: false,
        message: err.message || t('momo.collectionFailed'),
      });
      setStep('result');
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ── OTP submission ───────────────────────────────────────────── */
  const handleOTPSubmit = async () => {
    if (!otpValue || otpValue.length < 4) {
      toast.error(t('momo.otpTooShort'));
      return;
    }

    setOtpSubmitting(true);
    try {
      const res = await backendAPI.mobileMoney.verifyMomoOTP(transactionId, otpValue);

      if (res.success) {
        setResultData({
          success: true,
          message: res.data?.message || t('momo.otpVerified'),
          reference,
          status: 'completed',
        });
      } else {
        setResultData({
          success: false,
          message: res.error || t('momo.otpFailed'),
          reference,
        });
      }
      setStep('result');
    } catch (err: any) {
      toast.error(friendlyError(err, t('momo.otpFailed')));
    } finally {
      setOtpSubmitting(false);
    }
  };

  /* ── Navigation helpers ───────────────────────────────────────── */
  const goToCounterparty = () => {
    if (!validateForm()) return;
    setStep('counterparty');
  };

  const goToReview = () => {
    if (!validateCounterparty()) return;
    setStep('review');
  };

  const goToPin = () => setStep('pin');

  const handlePinSuccess = () => {
    setStep('review'); // brief visual, then submit
    handleSubmit();
  };

  /* ──────────────── Reusable UI atoms ──────────────── */
  const Select = ({ value, onChange, options, placeholder, error }: {
    value: string; onChange: (v: string) => void;
    options: { value: string; label: string }[]; placeholder?: string; error?: string;
  }) => (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full appearance-none ${tc.inputBg} border ${error ? 'border-red-500/60' : tc.borderLight} rounded-2xl px-4 py-4 pr-10 text-sm font-medium focus:outline-none focus:border-[#C7FF00]/50 ${tc.text} ${!value ? tc.textMuted : ''}`}
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none ${tc.textMuted}`} />
      {error && <p className="text-xs text-red-400 mt-1 px-1">{error}</p>}
    </div>
  );

  const Input = ({ value, onChange, placeholder, error, type = 'text', icon, autoFocus }: {
    value: string; onChange: (v: string) => void; placeholder?: string;
    error?: string; type?: string; icon?: React.ReactNode; autoFocus?: boolean;
  }) => (
    <div>
      <div className="relative">
        {icon && <div className={`absolute left-4 top-1/2 -translate-y-1/2 ${tc.textMuted}`}>{icon}</div>}
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={`w-full ${tc.inputBg} border ${error ? 'border-red-500/60' : tc.borderLight} rounded-2xl ${icon ? 'pl-11' : 'px-4'} pr-4 py-4 text-sm font-medium focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
        />
      </div>
      {error && <p className="text-xs text-red-400 mt-1 px-1">{error}</p>}
    </div>
  );

  /* ──────────── Header ──────────────── */
  const Header = ({ title, onBackAction }: { title: string; onBackAction: () => void }) => (
    <div className={`sticky top-0 z-30 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
      <div className="flex items-center justify-between px-5 py-4 pt-safe">
        <button onClick={onBackAction}
          className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}>
          <ArrowLeft size={20} className={tc.text} />
        </button>
        <h1 className={`text-base font-bold ${tc.text}`}>{title}</h1>
        <div className="w-10" />
      </div>
    </div>
  );

  /* ──────────── Step 1: Form ──────────────── */
  const renderForm = () => {
    const selectedProviderName = providers.find(p => p.bank_code === form.bank_code)?.name || '';

    return (
      <div className={`min-h-screen ${tc.bg} pb-safe`}>
        <Header title={t('momo.title')} onBackAction={onBack} />

        <div className="px-5 py-5 space-y-5">
          {/* Banner */}
          <div className="flex items-center gap-3 bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-2xl p-4">
            <div className="w-11 h-11 rounded-full bg-[#C7FF00]/20 flex items-center justify-center flex-shrink-0">
              <Smartphone size={22} className="text-[#C7FF00]" />
            </div>
            <div>
              <h2 className={`text-sm font-bold ${tc.text}`}>{t('momo.collectTitle')}</h2>
              <p className={`text-xs ${tc.textMuted} mt-0.5`}>{t('momo.collectDesc')}</p>
            </div>
          </div>

          {/* Currency */}
          <div>
            <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('momo.currency')}</label>
            {loadingProviders ? (
              <div className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl px-4 py-4 flex items-center gap-2`}>
                <Loader2 size={16} className="animate-spin text-[#C7FF00]" />
                <span className={`text-sm ${tc.textMuted}`}>{t('momo.loadingProviders')}</span>
              </div>
            ) : (
              <Select
                value={form.currency}
                onChange={v => updateField('currency', v)}
                options={currencies.map(c => ({
                  value: c.code,
                  label: `${CURRENCY_FLAG[c.code] || ''} ${c.code} — ${c.label}`,
                }))}
                placeholder={t('momo.selectCurrency')}
                error={errors.currency}
              />
            )}
          </div>

          {/* Provider */}
          {form.currency && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('momo.provider')}</label>
              {providers.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {providers.map(p => (
                    <button
                      key={p.bank_code}
                      onClick={() => updateField('bank_code', p.bank_code)}
                      className={`flex items-center gap-2.5 p-3.5 rounded-2xl border transition-all ${
                        form.bank_code === p.bank_code
                          ? 'bg-[#C7FF00]/10 border-[#C7FF00]/50'
                          : `${tc.card} ${tc.cardBorder} ${tc.hoverBg}`
                      }`}
                    >
                      <span className="text-xl">{p.icon}</span>
                      <span className={`text-xs font-semibold ${form.bank_code === p.bank_code ? 'text-[#C7FF00]' : tc.text}`}>
                        {p.name}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className={`text-xs ${tc.textMuted} px-1`}>{t('momo.noProviders')}</p>
              )}
              {errors.bank_code && <p className="text-xs text-red-400 mt-1 px-1">{errors.bank_code}</p>}
            </motion.div>
          )}

          {/* Phone number */}
          <div>
            <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('momo.phoneNumber')}</label>
            <Input
              value={form.account_number}
              onChange={v => updateField('account_number', v)}
              placeholder={t('momo.phonePlaceholder')}
              error={errors.account_number}
              type="tel"
              icon={<Phone size={16} />}
            />
          </div>

          {/* Amount */}
          <div>
            <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('momo.amount')}</label>
            <Input
              value={form.amount}
              onChange={v => updateField('amount', v.replace(/[^0-9.]/g, ''))}
              placeholder={t('momo.amountPlaceholder')}
              error={errors.amount}
              type="text"
              icon={<DollarSign size={16} />}
            />
            {form.currency && (
              <p className={`text-[11px] ${tc.textMuted} mt-1 px-1`}>
                {t('momo.lowestDenomNote')}: 1 {form.currency} = {DENOM[form.currency] || 1} {t('momo.units')}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('momo.description')}</label>
            <Input
              value={form.description}
              onChange={v => updateField('description', v)}
              placeholder={t('momo.descriptionPlaceholder')}
              error={errors.description}
              icon={<FileText size={16} />}
            />
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="fixed bottom-0 left-0 right-0 px-5 py-4 pb-safe bg-gradient-to-t from-black/90 via-black/70 to-transparent z-20">
          <button
            onClick={goToCounterparty}
            disabled={!form.currency || !form.bank_code}
            className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {t('common.next')}
            <Send size={16} />
          </button>
        </div>
      </div>
    );
  };

  /* ──────────── Step 2: Counterparty ──────────────── */
  const renderCounterparty = () => (
    <div className={`min-h-screen ${tc.bg} pb-safe`}>
      <Header title={t('momo.counterpartyTitle')} onBackAction={() => setStep('form')} />

      <div className="px-5 py-5 space-y-5">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
            <User size={20} className="text-blue-400" />
          </div>
          <div>
            <h3 className={`text-sm font-bold ${tc.text}`}>{t('momo.counterpartyHeading')}</h3>
            <p className={`text-xs ${tc.textMuted}`}>{t('momo.counterpartyDesc')}</p>
          </div>
        </div>

        <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl">
          <AlertCircle size={15} className="text-blue-400 mt-0.5 flex-shrink-0" />
          <p className={`text-[11px] ${tc.textMuted}`}>{t('momo.counterpartyOptionalNote')}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('momo.firstName')}</label>
            <Input value={form.cp_first_name} onChange={v => updateField('cp_first_name', v)} placeholder={t('momo.firstName')} error={errors.cp_first_name} />
          </div>
          <div>
            <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('momo.lastName')}</label>
            <Input value={form.cp_last_name} onChange={v => updateField('cp_last_name', v)} placeholder={t('momo.lastName')} error={errors.cp_last_name} />
          </div>
        </div>

        <div>
          <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('momo.email')}</label>
          <Input value={form.cp_email} onChange={v => updateField('cp_email', v)} placeholder="name@example.com" error={errors.cp_email} type="email" />
        </div>

        <div>
          <label className={`text-xs font-semibold ${tc.textMuted} mb-1.5 block px-1`}>{t('momo.cpPhone')}</label>
          <Input value={form.cp_phone} onChange={v => updateField('cp_phone', v)} placeholder={t('momo.phonePlaceholder')} error={errors.cp_phone} type="tel" icon={<Phone size={16} />} />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-5 py-4 pb-safe bg-gradient-to-t from-black/90 via-black/70 to-transparent z-20">
        <div className="flex gap-3">
          <button onClick={() => setStep('form')}
            className={`flex-1 ${tc.card} border ${tc.borderLight} py-4 rounded-full font-bold ${tc.text} flex items-center justify-center gap-2`}>
            <ArrowLeft size={16} /> {t('common.back')}
          </button>
          <button onClick={goToReview}
            className="flex-[2] bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] flex items-center justify-center gap-2">
            {t('momo.reviewBtn')} <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  /* ──────────── Step 3: Review ──────────────── */
  const renderReview = () => {
    const provider = providers.find(p => p.bank_code === form.bank_code);
    const currencyInfo = currencies.find(c => c.code === form.currency);

    return (
      <div className={`min-h-screen ${tc.bg} pb-safe`}>
        <Header title={t('momo.reviewTitle')} onBackAction={() => setStep('counterparty')} />

        <div className="px-5 py-5 space-y-5">
          {/* Amount hero */}
          <div className="text-center py-6">
            <p className={`text-xs ${tc.textMuted} mb-1`}>{t('momo.collectingAmount')}</p>
            <p className="text-4xl font-black text-[#C7FF00]">
              {parseFloat(form.amount || '0').toLocaleString()} <span className="text-xl">{form.currency}</span>
            </p>
            <p className={`text-xs ${tc.textMuted} mt-1`}>
              {t('momo.lowestDenom')}: {Math.round(parseFloat(form.amount || '0') * (DENOM[form.currency] || 1)).toLocaleString()}
            </p>
          </div>

          {/* Details card */}
          <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 space-y-3`}>
            <Row label={t('momo.currency')} value={`${CURRENCY_FLAG[form.currency] || ''} ${form.currency}`} tc={tc} />
            <Row label={t('momo.provider')} value={`${provider?.icon || ''} ${provider?.name || form.bank_code}`} tc={tc} />
            <Row label={t('momo.phoneNumber')} value={form.account_number} tc={tc} />
            <Row label={t('momo.description')} value={form.description} tc={tc} />
          </div>

          {/* Counterparty card */}
          {form.cp_first_name && (
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 space-y-3`}>
              <div className="flex items-center gap-2 mb-1">
                <User size={14} className="text-blue-400" />
                <span className={`text-xs font-bold ${tc.text}`}>{t('momo.counterpartyTitle')}</span>
              </div>
              <Row label={t('momo.name')} value={`${form.cp_first_name} ${form.cp_last_name}`} tc={tc} />
              {form.cp_email && <Row label={t('momo.email')} value={form.cp_email} tc={tc} />}
              {form.cp_phone && <Row label={t('momo.cpPhone')} value={form.cp_phone} tc={tc} />}
            </div>
          )}

          {/* Disclaimer */}
          <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <ShieldCheck size={15} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <p className={`text-[11px] ${tc.textMuted}`}>{t('momo.disclaimer')}</p>
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 px-5 py-4 pb-safe bg-gradient-to-t from-black/90 via-black/70 to-transparent z-20">
          <div className="flex gap-3">
            <button onClick={() => setStep('counterparty')}
              className={`flex-1 ${tc.card} border ${tc.borderLight} py-4 rounded-full font-bold ${tc.text} flex items-center justify-center gap-2`}>
              <ArrowLeft size={16} /> {t('common.back')}
            </button>
            <button onClick={goToPin} disabled={isSubmitting}
              className="flex-[2] bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2">
              {isSubmitting ? (
                <><Loader2 size={18} className="animate-spin" /> {t('common.processing')}</>
              ) : (
                <><ShieldCheck size={18} /> {t('momo.confirmCollect')}</>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ──────────── Step 4: OTP ──────────────── */
  const renderOTP = () => (
    <div className={`min-h-screen ${tc.bg}`}>
      <Header title={t('momo.otpTitle')} onBackAction={() => {
        setStep('result');
        setResultData({ success: false, message: t('momo.otpCancelled'), reference });
      }} />

      <div className="flex flex-col items-center px-5 py-12 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="w-20 h-20 rounded-full bg-amber-500/10 flex items-center justify-center mb-6"
        >
          <Hash size={36} className="text-amber-400" />
        </motion.div>

        <h2 className={`text-xl font-bold ${tc.text} mb-2`}>{t('momo.otpHeading')}</h2>
        <p className={`text-sm ${tc.textMuted} mb-8 max-w-xs`}>
          {t('momo.otpDesc')} <span className="font-semibold text-[#C7FF00]">{form.account_number}</span>
        </p>

        {/* OTP Input */}
        <div className="w-full max-w-xs mb-6">
          <input
            ref={otpInputRef}
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otpValue}
            onChange={e => setOtpValue(e.target.value.replace(/\D/g, ''))}
            autoFocus
            placeholder="● ● ● ● ● ●"
            className={`w-full text-center text-2xl tracking-[0.5em] font-mono ${tc.inputBg} border ${tc.borderLight} rounded-2xl px-4 py-5 focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
          />
        </div>

        <button
          onClick={handleOTPSubmit}
          disabled={otpSubmitting || otpValue.length < 4}
          className="w-full max-w-xs bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {otpSubmitting ? (
            <><Loader2 size={18} className="animate-spin" /> {t('momo.verifyingOtp')}</>
          ) : (
            <><CheckCircle size={18} /> {t('momo.verifyOtp')}</>
          )}
        </button>

        <p className={`text-xs ${tc.textMuted} mt-4`}>{t('momo.otpHint')}</p>
      </div>
    </div>
  );

  /* ──────────── Step 5: Result ──────────────── */
  const renderResult = () => (
    <div className={`min-h-screen ${tc.bg}`}>
      <Header title={t('momo.title')} onBackAction={onBack} />

      <div className="flex flex-col items-center justify-center px-5 py-16 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className={`w-24 h-24 rounded-full ${resultData?.success ? 'bg-[#C7FF00]/10' : 'bg-red-500/10'} flex items-center justify-center mb-6`}
        >
          {resultData?.success ? (
            <CheckCircle size={48} className="text-[#C7FF00]" />
          ) : (
            <AlertCircle size={48} className="text-red-400" />
          )}
        </motion.div>

        <h2 className={`text-xl font-bold ${tc.text} mb-3`}>
          {resultData?.success ? t('momo.successTitle') : t('momo.errorTitle')}
        </h2>
        <p className={`text-sm ${tc.textMuted} mb-2 max-w-xs`}>{resultData?.message}</p>
        {resultData?.reference && (
          <p className={`text-xs font-mono ${tc.textMuted} mb-1`}>Ref: {resultData.reference}</p>
        )}
        {resultData?.status && (
          <span className={`inline-block mt-1 px-3 py-1 rounded-full text-xs font-bold ${
            resultData.status === 'completed' ? 'bg-[#C7FF00]/20 text-[#C7FF00]' :
            resultData.status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            {resultData.status.toUpperCase()}
          </span>
        )}

        <div className="w-full space-y-3 max-w-xs mt-8">
          {resultData?.success && (
            <button
              onClick={() => { onComplete?.(); onBack(); }}
              className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98]"
            >
              {t('momo.done')}
            </button>
          )}
          {!resultData?.success && (
            <button
              onClick={() => { setResultData(null); setStep('form'); }}
              className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <RefreshCw size={16} /> {t('momo.tryAgain')}
            </button>
          )}
          <button
            onClick={onBack}
            className={`w-full ${tc.card} border ${tc.borderLight} py-4 rounded-full font-bold ${tc.text} ${tc.hoverBg} transition-all active:scale-[0.98]`}
          >
            {t('momo.backToDashboard')}
          </button>
        </div>
      </div>
    </div>
  );

  /* ──────────── Main render ──────────────── */
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={step}
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -30 }}
        transition={{ duration: 0.2 }}
      >
        {step === 'form' && renderForm()}
        {step === 'counterparty' && renderCounterparty()}
        {step === 'review' && renderReview()}
        {step === 'pin' && (
          <PINVerify
            onVerifySuccess={handlePinSuccess}
            onCancel={() => setStep('review')}
            transactionType="Mobile Money Collection"
            amount={form.amount}
            currency={form.currency}
          />
        )}
        {step === 'otp' && renderOTP()}
        {step === 'result' && renderResult()}
      </motion.div>
    </AnimatePresence>
  );
}

/* ── Row helper ──────────────────────────────── */
function Row({ label, value, tc }: { label: string; value: string; tc: any }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${tc.textMuted}`}>{label}</span>
      <span className={`text-xs font-medium ${tc.text} text-right max-w-[55%] truncate`}>{value}</span>
    </div>
  );
}