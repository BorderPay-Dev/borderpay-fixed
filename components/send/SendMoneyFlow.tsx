/**
 * BorderPay Africa - Send Money Flow (Local Payments Africa + US Payments)
 * 3 transfer methods:
 *   1. Bank Transfer — NGN/KES/GHS/UGX/XAF/XOF/TZS via banking provider
 *   2. Mobile Money — MOBILEMONEY scheme
 *   3. US Payment (ACH/Wire) — USD to registered counterparties via banking API
 *
 * Flow: Choose Method → Enter Details → Amount → Review → PIN → Success
 * i18n + theme-aware, neon green (#C7FF00) + black aesthetic
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Building2, Smartphone, Users, Search,
  CheckCircle, AlertCircle, Lock, Loader2, ChevronDown,
  Send, Info, ArrowRight, Copy, XCircle, Zap, Shield, Coins,
} from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { PINManager, BiometricManager } from '../../utils/security/SecurityManager';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '../ui/input-otp';
import { isFullEnrollment, deriveKycStatus } from '../../utils/config/environment';
import { friendlyError } from '../../utils/errors/friendlyError';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { validateTransferAmount } from '../../utils/fees';
import { computePayoutFee } from '../../utils/fees/engine';
import { classifyCorridor } from '../../utils/payouts/corridor';
import { ExternalCryptoWithdrawalFields, isValidCryptoAddress, type CryptoWithdrawalValues } from '../payouts/ExternalCryptoWithdrawalFields';
import { TRANSFERS_LIVE, EXTERNAL_ACCOUNTS_LIVE } from '../../utils/featureFlags';
import { financialCacheKey } from '../../utils/financial/cacheScope';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TransferMethod = 'bank' | 'mobile_money' | 'us_ach_wire' | 'stablecoin';
type Step = 'method' | 'details' | 'amount' | 'review' | 'pin' | 'processing' | 'success' | 'error';

interface Institution {
  code: string;
  name: string;
  type?: string;
}

interface Wallet {
  id: string;
  currency: string;
  balance: number;
  symbol?: string;
  bridge_wallet_id?: string | null;
}

interface ExternalAccountOption {
  id: string;
  bridge_external_account_id: string;
  account_type: 'us' | 'iban' | 'clabe' | 'pix';
  currency: string;
  account_owner_name: string | null;
  bank_name: string | null;
  last_4: string | null;
  rail: string | null;
  status: string;
}

interface SendMoneyFlowProps {
  userId: string;
  onBack: () => void;
  onComplete: () => void;
  onNavigate?: (screen: string) => void;
}

// ---------------------------------------------------------------------------
// Currency config
// ---------------------------------------------------------------------------

const SUPPORTED_CURRENCIES = [
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', flag: '🇳🇬', country: 'NG' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', flag: '🇰🇪', country: 'KE' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵', flag: '🇬🇭', country: 'GH' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', flag: '🇺🇬', country: 'UG' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', flag: '🇹🇿', country: 'TZ' },
  { code: 'XAF', name: 'CFA (Central)', symbol: 'FCFA', flag: '🇨🇲', country: 'CM' },
  { code: 'XOF', name: 'CFA (West)', symbol: 'FCFA', flag: '🇧🇯', country: 'BJ' },
  { code: 'SLE', name: 'Sierra Leonean Leone', symbol: 'Le', flag: '🇸🇱', country: 'SL' },
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT', flag: '🇲🇿', country: 'MZ' },
  { code: 'MWK', name: 'Malawian Kwacha', symbol: 'MK', flag: '🇲🇼', country: 'MW' },
];

// Bank transfer only supports NGN (NUBAN)
const BANK_TRANSFER_CURRENCIES = ['NGN'];

// Mobile Money supported currencies
const MOMO_CURRENCIES = ['XAF', 'KES', 'NGN', 'XOF', 'TZS', 'UGX', 'GHS', 'SLE', 'MZN', 'MWK'];

const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: '₦', KES: 'KSh', GHS: '₵', UGX: 'USh',
  XAF: 'FCFA', XOF: 'FCFA', TZS: 'TSh', USD: '$',
  SLE: 'Le', MZN: 'MT', MWK: 'MK',
  USDT: '$', USDC: '$', PYUSD: '$',
};

function getCurrencySymbol(code: string) {
  return CURRENCY_SYMBOLS[code] || code;
}

const SEND_WALLETS_CACHE_KEY = 'borderpay_send_wallets_v1';
const SEND_CAPS_CACHE_KEY = 'borderpay_send_caps_v1';


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SendMoneyFlow({ userId, onBack, onComplete, onNavigate }: SendMoneyFlowProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  // KYC gate
  const [kycStatus] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('borderpay_user');
      if (stored) {
        const user = JSON.parse(stored);
        return deriveKycStatus(user);            // Bridge-first (rejected overrides pending)
      }
    } catch {}
    return 'pending';
  });

  const sendWalletsCacheKey = useMemo(
    () => financialCacheKey(SEND_WALLETS_CACHE_KEY, { userId }),
    [userId],
  );
  const sendCapsCacheKey = useMemo(
    () => financialCacheKey(SEND_CAPS_CACHE_KEY, { userId }),
    [userId],
  );
  const cachedSendWallets = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(sendWalletsCacheKey) || '[]'); } catch { return []; }
  }, [sendWalletsCacheKey]);
  const cachedSendCaps = useMemo(() => {
    try { const v = JSON.parse(localStorage.getItem(sendCapsCacheKey) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }, [sendCapsCacheKey]);

  // Step & method
  const [step, setStep] = useState<Step>('method');
  const [method, setMethod] = useState<TransferMethod>('bank');

  // Currency & wallet
  const [wallets, setWallets] = useState<Wallet[]>(cachedSendWallets);
  const [selectedCurrency, setSelectedCurrency] = useState('NGN');
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  // Bank / MoMo details
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [selectedBank, setSelectedBank] = useState<Institution | null>(null);
  const [bankSearch, setBankSearch] = useState('');
  const [showBankList, setShowBankList] = useState(false);
  const [accountNumber, setAccountNumber] = useState('');
  const [resolvedName, setResolvedName] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');

  // External bank payout state (Bridge external accounts)
  const [externalAccounts, setExternalAccounts] = useState<ExternalAccountOption[]>([]);
  const [selectedExternalAccountId, setSelectedExternalAccountId] = useState<string>('');
  const [usMemo, setUsMemo] = useState('');

  // External stablecoin withdrawal — network + token + destination address.
  const [crypto, setCrypto] = useState<CryptoWithdrawalValues>({ network: 'tron', token: 'USDT', address: '' });

  // Withdraw-to-saved-wallet handoff: ExternalWalletsScreen stores the chosen
  // destination, then routes here. Prefill the stablecoin flow and jump in.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('borderpay_prefill_withdraw');
      if (!raw) return;
      localStorage.removeItem('borderpay_prefill_withdraw');
      const p = JSON.parse(raw);
      if (p?.address && p?.chain) {
        const token = String(p.asset || 'USDC').toUpperCase();
        setMethod('stablecoin');
        setSelectedCurrency(token);
        setCrypto({ network: p.chain as any, token: token as any, address: String(p.address) });
        setStep('details');
      }
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Client-controlled idempotency key for the bridge-transfer call.
  // Generated ONCE per Send-screen mount so that retries / Confirm
  // double-taps reuse the same key. Regenerate with newIdempotencyKey()
  // after a successful send if you want the next intent to be distinct.
  const [transferIdempotencyKey] = useState(() =>
    `bp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
  );

  // Amount & reason
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  // Account type (drives the African payout markup tier in the fee engine).
  const accountType: 'individual' | 'business' = useMemo(() => {
    try {
      const s = localStorage.getItem('borderpay_user');
      if (s) return JSON.parse(s).account_type === 'business' ? 'business' : 'individual';
    } catch { /* default below */ }
    return 'individual';
  }, []);

  // Bridge-backed capability gate for external bank accounts.
  const [externalAccountTypes, setExternalAccountTypes] = useState<Array<'us' | 'iban' | 'clabe' | 'pix'>>(
    cachedSendCaps.filter((x: any) => x === 'us' || x === 'iban' || x === 'clabe' || x === 'pix')
  );
  const selectedExternalAccount = useMemo(
    () => externalAccounts.find((x) => x.bridge_external_account_id === selectedExternalAccountId) || null,
    [externalAccounts, selectedExternalAccountId],
  );

  // BorderPay Network Fee — corridor-aware, via the revenue fee engine.
  // Provider stays invisible; the total is fully disclosed to the user.
  const networkFee = useMemo(() => {
    const num = parseFloat(amount);
    if (!num || num <= 0) return null;
    // The crypto withdrawal track forces the stablecoin route (flat 1.00%),
    // bypassing any country classification. Otherwise classify by destination
    // country (African countries also settle via stablecoin → 1.00%).
    const country = SUPPORTED_CURRENCIES.find(c => c.code === selectedCurrency)?.country;
    const corridor: 'international' | 'stablecoin' =
      method === 'stablecoin'
        ? 'stablecoin'
        : method === 'us_ach_wire'
          ? 'international'                                    // ACH/SEPA external bank
          : (classifyCorridor(country) === 'african' ? 'stablecoin' : 'international');
    return computePayoutFee({ corridor, accountType, amount: num, passThroughCost: 0 });
  }, [amount, selectedCurrency, accountType, method]);
  const [limitError, setLimitError] = useState<string | null>(null);

  // PIN & result
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingInstitutions, setLoadingInstitutions] = useState(false);
  const [transactionId, setTransactionId] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [newBalance, setNewBalance] = useState<number | null>(null);
  const hasPinFactor = useMemo(() => PINManager.hasPIN(userId), [userId]);
  const hasBiometricFactor = useMemo(() => BiometricManager.isEnrolled(userId), [userId]);
  const hasAnyAuthFactor = hasPinFactor || hasBiometricFactor;
  // ---------------------------------------------------------------------------
  // Snapshot hydration:
  // - first paint comes from cache
  // - one immediate background refresh only
  // - no delayed retry loop that contends with route navigation
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const hydrateOnce = async () => {
      try {
        const res: any = await backendAPI.financial.getSendRouteData();
        if (cancelled || !res?.success || !res?.data) return;
        const list = ((res.data as any).wallets || []).map((w: any) => ({
          id: w.id,
          currency: w.currency,
          balance: parseFloat(w.balance) || 0,
          symbol: getCurrencySymbol(w.currency),
          bridge_wallet_id: w.bridge_wallet_id ?? null,
        }));
        const types = Array.isArray(res?.data?.external_account_capabilities)
          ? res.data.external_account_capabilities
          : [];
        const ext = Array.isArray(res?.data?.external_accounts)
          ? res.data.external_accounts.map((row: any, idx: number) => {
              const rawType = String(row?.account_type || '').toLowerCase();
              const accountType: ExternalAccountOption['account_type'] =
                rawType === 'iban' || rawType === 'clabe' || rawType === 'pix' ? rawType : 'us';
              const rawCurrency = String(row?.currency || '');
              const currency = rawCurrency
                ? rawCurrency.toUpperCase()
                : (accountType === 'iban' ? 'EUR' : accountType === 'clabe' ? 'MXN' : accountType === 'pix' ? 'BRL' : 'USD');
              const externalId = String(row?.bridge_external_account_id || row?.external_account_id || row?.id || '');
              return {
                id: String(row?.id || externalId || `ext_${idx}`),
                bridge_external_account_id: externalId,
                account_type: accountType,
                currency,
                account_owner_name: row?.account_owner_name ?? null,
                bank_name: row?.bank_name ?? null,
                last_4: row?.last_4 ? String(row.last_4) : null,
                rail: row?.rail ?? (accountType === 'iban' ? 'sepa' : accountType === 'clabe' ? 'spei' : accountType === 'pix' ? 'pix' : 'ach'),
                status: String(row?.status || 'active'),
              } as ExternalAccountOption;
            }).filter((x: ExternalAccountOption) => !!x.bridge_external_account_id)
          : [];
        setWallets(list);
        setExternalAccountTypes(types.filter((x: any) => x === 'us' || x === 'iban' || x === 'clabe' || x === 'pix'));
        setExternalAccounts(ext);
        if (!selectedExternalAccountId && ext.length > 0) {
          setSelectedExternalAccountId(ext[0].bridge_external_account_id);
          if (ext[0]?.currency) setSelectedCurrency(ext[0].currency);
        }
        try { localStorage.setItem(sendWalletsCacheKey, JSON.stringify(list)); } catch { /* noop */ }
        try { localStorage.setItem(sendCapsCacheKey, JSON.stringify(types)); } catch { /* noop */ }
      } catch {
        // best effort: keep cached values
      }
    };
    hydrateOnce();
    return () => {
      cancelled = true;
    };
  }, [userId, sendWalletsCacheKey, sendCapsCacheKey, selectedExternalAccountId]);

  // Select wallet when currency changes
  useEffect(() => {
    const w = wallets.find(w => w.currency === selectedCurrency);
    setSelectedWallet(w || null);
  }, [selectedCurrency, wallets]);

  useEffect(() => {
    if (method !== 'us_ach_wire') return;
    if (selectedExternalAccount?.currency && selectedExternalAccount.currency !== selectedCurrency) {
      setSelectedCurrency(selectedExternalAccount.currency);
    }
  }, [method, selectedExternalAccount, selectedCurrency]);

  // Stablecoin sends must always use the selected stablecoin asset as source.
  useEffect(() => {
    if (method !== 'stablecoin') return;
    const tokenCurrency = String(crypto.token || 'USDC').toUpperCase();
    if (tokenCurrency !== selectedCurrency) setSelectedCurrency(tokenCurrency);
  }, [method, crypto.token, selectedCurrency]);

  // ---------------------------------------------------------------------------
  // Load institutions when method/currency changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Keep route first-paint instant: only fetch rails once the user actually
    // enters details, not while still on method selection.
    if (step === 'method') return;
    if (method === 'us_ach_wire' || method === 'stablecoin') return;
    loadInstitutions();
  }, [step, method, selectedCurrency]);

  const loadInstitutions = async () => {
    setLoadingInstitutions(true);
    setInstitutions([]);
    setSelectedBank(null);
    try {
      const type = method === 'mobile_money' ? 'MOBILE_MONEY' : undefined;
      const res = await backendAPI.localPayments.getInstitutions(selectedCurrency, type);
      if (res.success && res.data?.institutions) {
        setInstitutions(res.data.institutions);
      }
    } catch (e) {
    } finally {
      setLoadingInstitutions(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Account resolution (debounced)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    setResolvedName('');
    setResolveError('');

    if (!selectedBank || accountNumber.length < 6) return;

    const timer = setTimeout(() => resolveAccount(), 800);
    return () => clearTimeout(timer);
  }, [selectedBank, accountNumber]);

  const resolveAccount = async () => {
    if (!selectedBank || !accountNumber) return;
    setResolving(true);
    setResolvedName('');
    setResolveError('');
    try {
      const res = await backendAPI.localPayments.resolveAccount(
        selectedBank.code, accountNumber, selectedCurrency
      );
      if (res.success && res.data?.account_name) {
        setResolvedName(res.data.account_name);
      } else {
        setResolveError(res.error || t('send.accountResolveFailed'));
      }
    } catch {
      setResolveError(t('send.accountResolveFailed'));
    } finally {
      setResolving(false);
    }
  };

  // Validate transfer limits whenever amount/currency/method changes
  useEffect(() => {
    const num = parseFloat(amount);
    if (!num || method === 'us_ach_wire' || method === 'stablecoin') {
      setLimitError(null);
      return;
    }
    const channel = method === 'mobile_money' ? 'mobile_money' : 'bank';
    const symbol = getCurrencySymbol(selectedCurrency);
    const err = validateTransferAmount(num, selectedCurrency, channel, symbol);
    setLimitError(err);
  }, [amount, selectedCurrency, method]);

  // Fee is computed synchronously by the engine (networkFee useMemo) — no async
  // fetch needed for the review step.

  // ---------------------------------------------------------------------------
  // Navigation helpers
  // ---------------------------------------------------------------------------
  const goBack = () => {
    switch (step) {
      case 'method': onBack(); break;
      case 'details': setStep('method'); break;
      case 'amount': setStep('details'); break;
      case 'review': setStep('amount'); break;
      case 'pin': setStep('review'); break;
      case 'error': setStep('review'); break;
      default: onBack();
    }
  };

  const canProceedDetails = () => {
    if (method === 'us_ach_wire') return !!selectedExternalAccount;
    if (method === 'stablecoin') return isValidCryptoAddress(crypto.network, crypto.address);
    return !!selectedBank && accountNumber.length >= 6;
  };

  const canProceedAmount = () => {
    if (limitError) return false;
    const num = parseFloat(amount);
    if (method === 'us_ach_wire') {
      return num > 0 && selectedWallet && num <= selectedWallet.balance && reason.trim().length > 0;
    }
    if (method === 'stablecoin') {
      return num > 0 && selectedWallet && num <= selectedWallet.balance && reason.trim().length > 0;
    }
    return num > 0 && selectedWallet && num <= selectedWallet.balance;
  };

  // ---------------------------------------------------------------------------
  // Process transaction
  // ---------------------------------------------------------------------------
  const processTransaction = async (verifiedPin: string) => {
    setStep('processing');
    setErrorMessage('');

    try {
      let result: any;

      if (method === 'stablecoin') {
        result = await backendAPI.stablecoin.sendTransfer({
          amount: parseFloat(amount),
          reason: reason || 'Stablecoin transfer',
          address: crypto.address.trim(),
          chain: crypto.network,                                  // tron|polygon|arbitrum|solana|base|ethereum
          coin: crypto.token.toLowerCase() as 'usdc' | 'usdt',
          transaction_pin: verifiedPin,
          // Required by bridge-transfer v2. Reusing the per-mount key
          // means a network retry of the same Confirm tap returns the
          // original transfer_id (server-side replay), not a duplicate.
          idempotency_key: transferIdempotencyKey,
        });
      } else if (method === 'us_ach_wire') {
        if (!selectedExternalAccount) {
          throw new Error('Select an external account');
        }
        const destinationRail =
          selectedExternalAccount.account_type === 'iban' ? 'sepa'
          : selectedExternalAccount.account_type === 'clabe' ? 'spei'
          : selectedExternalAccount.account_type === 'pix' ? 'pix'
          : 'ach';
        result = await backendAPI.bridge.transfer.create({
          idempotency_key: transferIdempotencyKey,
          source: {
            payment_rail: 'bridge_wallet',
            currency: selectedCurrency,
            amount: String(parseFloat(amount)),
            ...(selectedWallet?.bridge_wallet_id ? { bridge_wallet_id: selectedWallet.bridge_wallet_id } : {}),
          },
          destination: {
            payment_rail: destinationRail,
            currency: selectedExternalAccount.currency,
            external_account_id: selectedExternalAccount.bridge_external_account_id,
          },
        });
      } else {
        const meta = method === 'mobile_money' ? { scheme: 'MOBILEMONEY' } : undefined;
        result = await backendAPI.localPayments.transfer({
          bank_code: selectedBank!.code,
          account_number: accountNumber,
          amount: parseFloat(amount),
          currency: selectedCurrency,
          reason: reason || 'Transfer',
          transaction_pin: verifiedPin,
          wallet_id: selectedWallet?.id,
          meta,
        });
      }

      if (result.success) {
        // bridge-transfer returns { transfer_id, state }; legacy paths return
        // { transaction_id, reference, new_balance }. Surface whichever exists.
        setTransactionId(result.data?.transaction_id || result.data?.transfer_id || '');
        setTransactionRef(result.data?.reference || result.data?.transfer_id || '');
        setNewBalance(result.data?.new_balance ?? null);
        setStep('success');
        toast.success(t('send.txSuccessful'));
      } else {
        // Map structured server codes to friendly user-facing messages.
        // 402 plan_required is intercepted globally by apiCall and pops
        // UpgradeModal; we don't surface it as a transfer failure.
        const code = (result as any)?.code;
        const friendly =
          code === 'country_not_supported' ? (result.error || 'Your country is not yet supported. We are bringing it online soon.')
        : code === 'no_partner'           ? (result.error || 'This payout rail is coming soon through BorderPay.')
        : code === 'rails_future_state'   ? 'This transfer rail is launching soon. Use the stablecoin path for now.'
        : code === 'kyc_not_approved'     ? 'Finish identity verification before sending funds.'
        : code === 'no_customer'          ? 'Finish account setup before sending funds.'
        : code === 'plan_required'        ? ''      // UpgradeModal handles it; suppress duplicate toast
        : (result.error || t('send.txFailed'));

        setErrorMessage(friendly || t('send.txFailed'));
        setStep('error');
        if (friendly) toast.error(friendlyError(friendly, t('send.txFailed')));
      }
    } catch (error: any) {
      setErrorMessage(error.message || t('send.txFailed'));
      setStep('error');
      toast.error(friendlyError(error, t('send.txFailed')));
    }
  };

  const handlePinComplete = async (value: string) => {
    setPin(value);
    if (value.length === 6) {
      if (!hasPinFactor) {
        toast.error('Set a transaction PIN or use biometric verification to continue.');
        setPin('');
        return;
      }
      // Verify PIN locally first before sending to backend
      const isValid = await PINManager.verifyPIN(userId, value);
      if (!isValid) {
        toast.error(t('send.incorrectPin') || 'Incorrect PIN');
        setPin('');
        return;
      }
      processTransaction(value);
    }
  };

  // ---------------------------------------------------------------------------
  // Filtered institutions
  // ---------------------------------------------------------------------------
  const filteredBanks = institutions.filter(b =>
    b.name.toLowerCase().includes(bankSearch.toLowerCase()) ||
    b.code.toLowerCase().includes(bankSearch.toLowerCase())
  );

  // ---------------------------------------------------------------------------
  // Step title
  // ---------------------------------------------------------------------------
  const getStepTitle = () => {
    switch (step) {
      case 'method': return t('send.title');
      case 'details': return method === 'bank' ? t('send.bankDetails') : method === 'mobile_money' ? t('send.momoDetails') : method === 'us_ach_wire' ? t('send.usPaymentDetails') : method === 'stablecoin' ? 'Stablecoin Transfer' : t('send.borderPayDetails');
      case 'amount': return t('send.amount');
      case 'review': return t('send.reviewTransfer');
      case 'pin': return t('send.verifyTransaction');
      case 'processing': return t('send.processingTx');
      case 'success': return t('send.txSuccessful');
      case 'error': return t('send.txFailed');
      default: return t('send.title');
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className={`min-h-screen ${tc.bg} ${tc.text} pb-safe relative`}>
      {!isFullEnrollment(kycStatus) && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0B0E11]/95 backdrop-blur-sm px-6">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-yellow-400" />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Verification Required</h2>
            <p className="text-sm text-gray-400 mb-6">Complete identity verification to access this feature.</p>
            <button
              onClick={onBack}
              className="w-full h-12 rounded-2xl bg-[#C7FF00] text-[#0B0E11] font-bold text-sm"
            >
              Go Back
            </button>
          </div>
        </div>
      )}
      {/* Floating back chip (consistent with the rest of the app); hidden on
          terminal steps where going back is not meaningful. */}
      {step !== 'success' && step !== 'processing' && (
        <FloatingBackButton onBack={goBack} />
      )}

      {/* Header — title only; back is the floating chip above. */}
      <div className={`sticky top-0 z-30 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-center px-5 py-4 pt-safe-header">
          <h1 className={`text-base font-bold ${tc.text}`}>{getStepTitle()}</h1>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 1: Choose Transfer Method                                     */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'method' && (
          <motion.div
            key="method"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="px-5 py-6"
          >
            <p className={`text-sm ${tc.textSecondary} mb-3`}>{t('send.chooseMethod')}</p>

            {/* External Stablecoin Withdrawal — the primary African/global payout
                track. Interactive only when TRANSFERS_LIVE is on; until the
                money-movement flag flips it stays a non-interactive "Pending
                evidence" card (no user-facing money movement). The crypto form,
                fee engine (flat 1.00%), and address validation are fully wired
                behind this gate. */}
            <div className="space-y-3">
              {TRANSFERS_LIVE ? (
                <button
                  type="button"
                  onClick={() => {
                    const tokenCurrency = String(crypto.token || 'USDC').toUpperCase();
                    setMethod('stablecoin');
                    setSelectedCurrency(tokenCurrency);
                    setStep('details');
                  }}
                  className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-5 flex items-center gap-4 ${tc.hoverBg} transition-colors`}
                >
                  <div className="w-12 h-12 rounded-full bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
                    <Coins size={22} className="text-cyan-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className={`text-sm font-semibold ${tc.text}`}>External Stablecoin Withdrawal</p>
                    <p className={`text-xs ${tc.textMuted} mt-0.5`}>USDT / USDC to any external wallet — TRON, Polygon, Arbitrum, Solana, Base</p>
                  </div>
                  <ArrowRight size={18} className={tc.textMuted} />
                </button>
              ) : (
                <div
                  className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-5 flex items-center gap-4 opacity-60 cursor-not-allowed`}
                  aria-disabled="true"
                >
                  <div className="w-12 h-12 rounded-full bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
                    <Coins size={22} className="text-cyan-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className={`text-sm font-semibold ${tc.text}`}>External Stablecoin Withdrawal</p>
                    <p className={`text-xs ${tc.textMuted} mt-0.5`}>USDT / USDC to an external wallet — pending sandbox evidence sign-off</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">Pending evidence</span>
                </div>
              )}

              {/* External bank accounts — only where Bridge supports them.
                  Otherwise, stablecoin is the only visible payout rail. */}
              {externalAccountTypes.length > 0 && (
                EXTERNAL_ACCOUNTS_LIVE ? (
                  <button
                    type="button"
                    onClick={() => { setMethod('us_ach_wire'); setStep('details'); }}
                    className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-5 flex items-center gap-4 ${tc.hoverBg} transition-colors`}
                  >
                    <div className="w-12 h-12 rounded-full bg-[#C7FF00]/15 flex items-center justify-center flex-shrink-0">
                      <Building2 size={22} className="text-[#C7FF00]" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className={`text-sm font-semibold ${tc.text}`}>External bank account</p>
                      <p className={`text-xs ${tc.textMuted} mt-0.5`}>
                        {externalAccountTypes.includes('us') && externalAccountTypes.includes('iban')
                          ? 'ACH (US) · SEPA (EEA) — pay to a linked account'
                          : externalAccountTypes.includes('us')
                            ? 'ACH (US) — pay to a linked account'
                            : 'SEPA (EEA) — pay to a linked account'}
                      </p>
                    </div>
                    <ArrowRight size={18} className={tc.textMuted} />
                  </button>
                ) : (
                  <div
                    className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-5 flex items-center gap-4 opacity-60 cursor-not-allowed`}
                    aria-disabled="true"
                  >
                    <div className={`w-12 h-12 rounded-full ${tc.bgAlt} flex items-center justify-center flex-shrink-0`}>
                      <Building2 size={22} className={tc.textMuted} />
                    </div>
                    <div className="flex-1 text-left">
                      <p className={`text-sm font-semibold ${tc.text}`}>External bank account</p>
                      <p className={`text-xs ${tc.textMuted} mt-0.5`}>
                        {externalAccountTypes.includes('us') && externalAccountTypes.includes('iban')
                          ? 'ACH (US) · SEPA (EEA) — coming soon'
                          : externalAccountTypes.includes('us')
                            ? 'ACH (US) — coming soon'
                            : 'SEPA (EEA) — coming soon'}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/[0.06] text-white/60">Soon</span>
                  </div>
                )
              )}
            </div>

            <div className={`mt-6 flex items-start gap-2 px-4 py-3 ${tc.card} rounded-xl border ${tc.borderLight}`}>
              <Info size={16} className="text-[#C7FF00] mt-0.5 flex-shrink-0" />
              <p className={`text-xs ${tc.textMuted}`}>
                Stablecoin transfers settle in seconds. Other payout rails launch through BorderPay.
              </p>
            </div>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 2: Enter Details                                              */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'details' && (
          <motion.div
            key="details"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-5 py-6"
          >
            {/* Currency Picker (Africa only — not for P2P, US, or Stablecoin) */}
            {method !== 'us_ach_wire' && method !== 'stablecoin' && (() => {
              const availableCurrencies = method === 'bank'
                ? SUPPORTED_CURRENCIES.filter(c => BANK_TRANSFER_CURRENCIES.includes(c.code))
                : SUPPORTED_CURRENCIES.filter(c => MOMO_CURRENCIES.includes(c.code));
              return (
              <div className="mb-5">
                <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>{t('send.selectCurrency')}</label>
                {/* Bank transfer is NGN only — show fixed, no picker */}
                {method === 'bank' ? (
                  <div className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl px-4 py-3.5 flex items-center gap-3`}>
                    <span className="text-xl">🇳🇬</span>
                    <div>
                      <p className={`text-sm font-semibold ${tc.text}`}>NGN</p>
                      <p className={`text-xs ${tc.textMuted}`}>Nigerian Naira (NUBAN)</p>
                    </div>
                    <CheckCircle size={16} className="text-[#C7FF00] ml-auto" />
                  </div>
                ) : (
                <>
                  <button
                    onClick={() => setShowCurrencyPicker(!showCurrencyPicker)}
                    className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl px-4 py-3.5 flex items-center justify-between ${tc.hoverBg} transition-colors`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{availableCurrencies.find(c => c.code === selectedCurrency)?.flag}</span>
                      <div>
                        <p className={`text-sm font-semibold ${tc.text}`}>{selectedCurrency}</p>
                        <p className={`text-xs ${tc.textMuted}`}>{availableCurrencies.find(c => c.code === selectedCurrency)?.name}</p>
                      </div>
                    </div>
                    <ChevronDown size={18} className={`${tc.textMuted} transition-transform ${showCurrencyPicker ? 'rotate-180' : ''}`} />
                  </button>

                  {showCurrencyPicker && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`mt-2 ${tc.card} border ${tc.cardBorder} rounded-2xl overflow-hidden shadow-xl max-h-64 overflow-y-auto`}
                    >
                      {availableCurrencies.map(cur => (
                        <button
                          key={cur.code}
                          onClick={() => {
                            setSelectedCurrency(cur.code);
                            setShowCurrencyPicker(false);
                            setSelectedBank(null);
                            setAccountNumber('');
                            setResolvedName('');
                          }}
                          className={`w-full flex items-center gap-3 px-4 py-3 ${tc.hoverBg} transition-colors text-left ${
                            selectedCurrency === cur.code ? 'bg-[#C7FF00]/10' : ''
                          }`}
                        >
                          <span className="text-lg">{cur.flag}</span>
                          <div className="flex-1">
                            <p className={`text-sm font-semibold ${tc.text}`}>{cur.code}</p>
                            <p className={`text-xs ${tc.textMuted}`}>{cur.name}</p>
                          </div>
                          {selectedCurrency === cur.code && (
                            <CheckCircle size={16} className="text-[#C7FF00]" />
                          )}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </>
                )}
              </div>
              );
            })()}

            {/* Bank / MoMo Selection (Africa only) */}
            {method !== 'us_ach_wire' && method !== 'stablecoin' && (
              <>
                <div className="mb-4">
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>
                    {method === 'bank' ? t('send.selectBank') : t('send.selectProvider')}
                  </label>

                  <button
                    onClick={() => setShowBankList(!showBankList)}
                    className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl px-4 py-3.5 flex items-center justify-between ${tc.hoverBg} transition-colors`}
                  >
                    <span className={`text-sm ${selectedBank ? `font-semibold ${tc.text}` : tc.textMuted}`}>
                      {selectedBank ? selectedBank.name : (method === 'bank' ? t('send.chooseBankPlaceholder') : t('send.chooseProviderPlaceholder'))}
                    </span>
                    {loadingInstitutions ? (
                      <Loader2 size={16} className="text-[#C7FF00] animate-spin" />
                    ) : (
                      <ChevronDown size={18} className={`${tc.textMuted} transition-transform ${showBankList ? 'rotate-180' : ''}`} />
                    )}
                  </button>

                  {showBankList && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`mt-2 ${tc.card} border ${tc.cardBorder} rounded-2xl overflow-hidden shadow-xl`}
                    >
                      {/* Search */}
                      <div className={`px-3 py-2 border-b ${tc.borderLight}`}>
                        <div className="relative">
                          <Search size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${tc.textMuted}`} />
                          <input
                            type="text"
                            value={bankSearch}
                            onChange={e => setBankSearch(e.target.value)}
                            placeholder={t('send.searchBanks')}
                            className={`w-full ${tc.inputBg} rounded-xl pl-9 pr-3 py-2.5 text-sm placeholder:${tc.textMuted} focus:outline-none`}
                            autoFocus
                          />
                        </div>
                      </div>

                      <div className="max-h-56 overflow-y-auto">
                        {filteredBanks.length === 0 ? (
                          <p className={`text-sm ${tc.textMuted} text-center py-6`}>{loadingInstitutions ? t('common.loading') : t('send.noBanksFound')}</p>
                        ) : (
                          filteredBanks.map(bank => (
                            <button
                              key={bank.code}
                              onClick={() => {
                                setSelectedBank(bank);
                                setShowBankList(false);
                                setBankSearch('');
                                setResolvedName('');
                                setResolveError('');
                              }}
                              className={`w-full text-left px-4 py-3 ${tc.hoverBg} transition-colors border-b ${tc.borderLight} last:border-0 ${
                                selectedBank?.code === bank.code ? 'bg-[#C7FF00]/10' : ''
                              }`}
                            >
                              <p className={`text-sm font-medium ${tc.text}`}>{bank.name}</p>
                              <p className={`text-xs ${tc.textMuted}`}>{bank.code}</p>
                            </button>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Account Number */}
                <div className="mb-4">
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>
                    {method === 'bank' ? t('send.accountNumber') : t('send.phoneNumber')}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={accountNumber}
                    onChange={e => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder={method === 'bank' ? '0123456789' : '+2348012345678'}
                    className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                  />
                </div>

                {/* Account Resolution Result */}
                {resolving && (
                  <div className="flex items-center gap-2 mb-4 px-1">
                    <Loader2 size={14} className="text-[#C7FF00] animate-spin" />
                    <span className={`text-xs ${tc.textMuted}`}>{t('send.verifyingAccount')}</span>
                  </div>
                )}
                {resolvedName && !resolving && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 mb-4 px-3 py-2.5 bg-green-500/10 border border-green-500/20 rounded-xl"
                  >
                    <CheckCircle size={16} className="text-green-400" />
                    <span className="text-sm text-green-400 font-medium">{resolvedName}</span>
                  </motion.div>
                )}
                {resolveError && !resolving && (
                  <div className="flex items-center gap-2 mb-4 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <AlertCircle size={16} className="text-red-400" />
                    <span className="text-xs text-red-400">{resolveError}</span>
                  </div>
                )}
              </>
            )}

            {/* Stablecoin Transfer Details */}
            {method === 'stablecoin' && (
              <>
                {/* External crypto withdrawal — network + token + validated address */}
                <div className="mb-5">
                  <ExternalCryptoWithdrawalFields
                    values={crypto}
                    onChange={(patch) => setCrypto((c) => ({ ...c, ...patch }))}
                  />
                </div>

                {/* Funding Source */}
                <div className="mb-4">
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>Funding Source</label>
                  <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl px-4 py-3.5 flex items-center gap-3`}>
                    <span className="text-lg">🇺🇸</span>
                    <div className="flex-1">
                      <p className={`text-sm font-semibold ${tc.text}`}>{selectedCurrency} Wallet</p>
                      <p className={`text-xs ${tc.textMuted}`}>{selectedCurrency} wallet balance funds this transfer</p>
                    </div>
                    <CheckCircle size={16} className="text-[#C7FF00]" />
                  </div>
                </div>
              </>
            )}

            {/* US Payment (ACH/Wire) Details */}
            {method === 'us_ach_wire' && (
              <div className="space-y-4">
                <div>
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>Destination external account</label>
                  {externalAccounts.length === 0 ? (
                    <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4`}>
                      <p className={`text-sm ${tc.textSecondary} mb-3`}>No external accounts available.</p>
                      <button
                        type="button"
                        onClick={() => onNavigate?.('external-accounts')}
                        className="text-sm font-semibold text-[#C7FF00]"
                      >
                        Open External Accounts
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {externalAccounts.map((acc) => (
                        <button
                          key={acc.bridge_external_account_id}
                          type="button"
                          onClick={() => {
                            setSelectedExternalAccountId(acc.bridge_external_account_id);
                            if (acc.currency) setSelectedCurrency(acc.currency);
                          }}
                          className={`w-full text-left ${tc.card} border rounded-2xl p-3.5 transition-colors ${
                            selectedExternalAccountId === acc.bridge_external_account_id
                              ? 'border-[#C7FF00]/60 bg-[#C7FF00]/10'
                              : tc.cardBorder
                          }`}
                        >
                          <p className={`text-sm font-semibold ${tc.text}`}>
                            {acc.account_owner_name || 'External account'} • {acc.currency}
                          </p>
                          <p className={`text-xs ${tc.textMuted} mt-1`}>
                            {(acc.bank_name || acc.account_type.toUpperCase())}{acc.last_4 ? ` • ****${acc.last_4}` : ''}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Continue Button */}
            <button
              onClick={() => setStep('amount')}
              disabled={!canProceedDetails()}
              className="w-full mt-4 bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {t('send.continue')}
            </button>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 3: Enter Amount                                               */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'amount' && (
          <motion.div
            key="amount"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-5 py-6"
          >
            {/* Recipient summary */}
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 mb-6`}>
              <p className={`text-xs ${tc.textMuted} mb-1`}>{t('send.sendingTo')}</p>
              {method === 'stablecoin' ? (
                <>
                  <p className={`text-sm font-mono font-semibold ${tc.text} truncate`}>{crypto.address}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#C7FF00]/15 text-[#C7FF00] uppercase">
                      {crypto.network}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-blue-500/15 text-blue-400">{crypto.token}</span>
                  </div>
                </>
              ) : method === 'us_ach_wire' ? (
                <>
                  <p className={`text-sm font-semibold ${tc.text}`}>{selectedExternalAccount?.account_owner_name || 'External account'}</p>
                  <p className={`text-xs ${tc.textMuted}`}>
                    {(selectedExternalAccount?.bank_name || selectedExternalAccount?.account_type?.toUpperCase() || 'Account')}
                    {selectedExternalAccount?.last_4 ? ` • ****${selectedExternalAccount.last_4}` : ''}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-blue-500/15 text-blue-400 uppercase">
                      {selectedExternalAccount?.rail || selectedExternalAccount?.account_type || 'bank'}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <p className={`text-sm font-semibold ${tc.text}`}>{resolvedName || accountNumber}</p>
                  <p className={`text-xs ${tc.textMuted}`}>{selectedBank?.name} • {accountNumber}</p>
                </>
              )}
            </div>

            {/* Amount input */}
            <div className="mb-5">
              <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>{t('send.amount')}</label>
              <div className="relative">
                <span className={`absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold ${tc.text}`}>
                  {getCurrencySymbol(selectedCurrency)}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl pl-14 pr-4 py-5 text-2xl font-bold focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                  placeholder="0.00"
                />
              </div>
              {selectedWallet && (
                <div className="flex items-center justify-between mt-2 px-1">
                  <p className={`text-xs ${tc.textMuted}`}>
                    {t('send.available')}: {getCurrencySymbol(selectedCurrency)}{selectedWallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                  <button
                    onClick={() => setAmount(selectedWallet.balance.toString())}
                    className="text-xs text-[#C7FF00] font-semibold"
                  >
                    {t('send.sendMax')}
                  </button>
                </div>
              )}
              {!selectedWallet && (
                <p className="text-xs text-red-400 mt-2 px-1">{t('send.noWalletForCurrency')}</p>
              )}
              {limitError && (
                <p className="text-xs text-red-400 mt-2 px-1 flex items-center gap-1">
                  <AlertCircle size={12} className="flex-shrink-0" />
                  {limitError}
                </p>
              )}
            </div>

            {/* Memo (US Payments only) */}
            {method === 'us_ach_wire' && (
              <div className="mb-4">
                <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>{t('send.usMemo')}</label>
                <input
                  type="text"
                  value={usMemo}
                  onChange={e => setUsMemo(e.target.value)}
                  placeholder={t('send.usMemoPlaceholder')}
                  className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                />
              </div>
            )}

            {/* Reason */}
            <div className="mb-6">
              <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>{t('send.reason')}</label>
              <input
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={method === 'us_ach_wire' ? t('send.usReasonPlaceholder') : t('send.reasonPlaceholder')}
                className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
              />
            </div>

            <button
              onClick={() => setStep('review')}
              disabled={!canProceedAmount()}
              className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {t('send.reviewTransfer')}
            </button>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 4: Review                                                     */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'review' && (
          <motion.div
            key="review"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-5 py-6"
          >
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5 mb-6`}>
              {/* Amount */}
              <div className="text-center mb-5">
                <p className={`text-xs ${tc.textMuted} mb-1`}>{t('send.youAreSending')}</p>
                <p className="text-3xl font-bold text-[#C7FF00]">
                  {getCurrencySymbol(selectedCurrency)}{parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                <p className={`text-xs ${tc.textMuted} mt-1`}>{selectedCurrency}</p>
              </div>

              <div className={`h-px ${tc.border} mb-4`} />

              {/* Details */}
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className={`text-xs ${tc.textMuted}`}>{t('send.method')}</span>
                  <span className={`text-sm font-medium ${tc.text}`}>
                    {method === 'bank' ? t('send.bankTransfer') : method === 'mobile_money' ? t('send.mobileMoney') : method === 'us_ach_wire' ? t('send.usAchWire') : method === 'stablecoin' ? 'Stablecoin' : t('send.borderPayPay')}
                  </span>
                </div>

                {method !== 'us_ach_wire' && method !== 'stablecoin' && (
                  <>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>{method === 'bank' ? t('send.bankName') : t('send.provider')}</span>
                      <span className={`text-sm font-medium ${tc.text}`}>{selectedBank?.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>{t('send.accountNumber')}</span>
                      <span className={`text-sm font-mono ${tc.text}`}>{accountNumber}</span>
                    </div>
                    {resolvedName && (
                      <div className="flex justify-between">
                        <span className={`text-xs ${tc.textMuted}`}>{t('send.accountName')}</span>
                        <span className={`text-sm font-medium ${tc.text}`}>{resolvedName}</span>
                      </div>
                    )}
                  </>
                )}

                {method === 'us_ach_wire' && (
                  <>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>External account</span>
                      <span className={`text-sm font-medium ${tc.text} text-right max-w-[180px]`}>{selectedExternalAccount?.account_owner_name || 'External account'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>Institution</span>
                      <span className={`text-sm font-medium ${tc.text}`}>{selectedExternalAccount?.bank_name || selectedExternalAccount?.account_type?.toUpperCase()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>Account</span>
                      <span className={`text-sm font-mono ${tc.text}`}>{selectedExternalAccount?.last_4 ? `****${selectedExternalAccount.last_4}` : '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>Rail</span>
                      <span className="text-sm font-semibold text-blue-400 uppercase">{selectedExternalAccount?.rail || selectedExternalAccount?.account_type || 'bank'}</span>
                    </div>
                    {usMemo && (
                      <div className="flex justify-between">
                        <span className={`text-xs ${tc.textMuted}`}>{t('send.usMemo')}</span>
                        <span className={`text-sm ${tc.text}`}>{usMemo}</span>
                      </div>
                    )}
                  </>
                )}

                {method === 'stablecoin' && (
                  <>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>Network</span>
                      <span className={`text-sm font-semibold ${tc.text} uppercase`}>{crypto.network}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>Coin</span>
                      <span className={`text-sm font-medium ${tc.text}`}>{crypto.token}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>Address</span>
                      <span className={`text-xs font-mono ${tc.text} truncate ml-4 max-w-[180px]`}>{crypto.address}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>Funding Source</span>
                      <span className={`text-sm font-medium ${tc.text}`}>{selectedCurrency} Wallet</span>
                    </div>
                  </>
                )}


                {reason && (
                  <div className="flex justify-between">
                    <span className={`text-xs ${tc.textMuted}`}>{t('send.reason')}</span>
                    <span className={`text-sm ${tc.text}`}>{reason}</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span className={`text-xs ${tc.textMuted}`}>{t('send.currency')}</span>
                  <span className={`text-sm font-medium ${tc.text}`}>{selectedCurrency}</span>
                </div>
              </div>
            </div>

            {/* BorderPay Network Fee — unified, fully-disclosed total.
                Provider stays invisible; the user sees exactly what they pay. */}
            {networkFee && (
              <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 mb-4`}>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className={tc.textMuted}>Amount</span>
                    <span className={tc.text}>{getCurrencySymbol(selectedCurrency)}{parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {selectedCurrency}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className={tc.textMuted}>
                      BorderPay Network Fee{networkFee.feePercent > 0 ? ` (${networkFee.feePercent.toFixed(networkFee.feePercent < 1 ? 2 : 3)}%)` : ''}
                    </span>
                    <span className={networkFee.totalFee === 0 ? 'text-[#C7FF00]' : tc.text}>
                      {networkFee.totalFee === 0
                        ? 'Free'
                        : `${getCurrencySymbol(selectedCurrency)}${networkFee.totalFee.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${selectedCurrency}`}
                    </span>
                  </div>
                  <div className={`h-px ${tc.border} my-1`} />
                  <div className="flex justify-between text-sm font-bold">
                    <span className={tc.text}>Total</span>
                    <span className="text-[#C7FF00]">
                      {getCurrencySymbol(selectedCurrency)}{(parseFloat(amount) + networkFee.totalFee).toLocaleString(undefined, { minimumFractionDigits: 2 })} {selectedCurrency}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className={tc.textMuted}>Recipient gets</span>
                    <span className={tc.textMuted}>
                      {getCurrencySymbol(selectedCurrency)}{parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {selectedCurrency}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Warning */}
            <div className="flex items-start gap-2 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl mb-6">
              <AlertCircle size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-yellow-400">{t('send.reviewWarning')}</p>
            </div>

            <button
              onClick={() => {
                if (!hasAnyAuthFactor) {
                  toast.error('Set a transaction PIN or biometric verification before sending payouts.');
                  onNavigate?.('settings');
                  return;
                }
                setStep('pin');
              }}
              className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98]"
            >
              {t('send.confirmAndPay')}
            </button>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 5: PIN Verification                                           */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {step === 'pin' && (
          <motion.div
            key="pin"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-5 py-8"
          >
            <div className="text-center mb-8">
              <div className="w-20 h-20 rounded-full bg-[#C7FF00]/10 flex items-center justify-center mx-auto mb-4">
                <Lock className="w-10 h-10 text-[#C7FF00]" />
              </div>
              <h2 className={`text-lg font-bold mb-2 ${tc.text}`}>{t('send.enterPinToConfirm')}</h2>
              <p className={`text-sm ${tc.textSecondary}`}>
                {getCurrencySymbol(selectedCurrency)}{parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} → {method === 'stablecoin' ? `${crypto.address.slice(0, 8)}...${crypto.address.slice(-6)}` : method === 'us_ach_wire' ? (selectedExternalAccount?.account_owner_name || 'External account') : resolvedName || accountNumber}
              </p>
            </div>

            <div className="flex justify-center mb-8">
              <InputOTP
                maxLength={6}
                value={pin}
                onChange={handlePinComplete}
                inputMode="numeric"
                pattern="[0-9]*"
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>

            {/* Biometric option */}
            {hasBiometricFactor && (
              <div className="px-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs text-gray-500 uppercase tracking-widest">or</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
                <button
                  onClick={async () => {
                    const result = await BiometricManager.verify(userId);
                    if (result.success) {
                      processTransaction('__biometric__');
                    } else {
                      toast.error(friendlyError(result.error, 'Biometric verification failed'));
                    }
                  }}
                  className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-white hover:bg-white/[0.07] transition-all active:scale-[0.98]"
                >
                  <Shield size={20} className="text-[#C7FF00]" />
                  <span className="text-sm font-semibold">Use Biometric</span>
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 6: Processing                                                 */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'processing' && (
          <motion.div
            key="processing"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="px-5 py-16 text-center"
          >
            <div className="w-16 h-16 rounded-full bg-[#C7FF00]/10 flex items-center justify-center mx-auto mb-6">
              <Loader2 size={32} className="text-[#C7FF00] animate-spin" />
            </div>
            <p className={`text-base font-semibold ${tc.text} mb-2`}>{t('send.processingTx')}</p>
            <p className={`text-sm ${tc.textMuted}`}>{t('send.pleaseWait')}</p>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 7: Success                                                    */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'success' && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="px-5 py-10 text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut', delay: 0.2 }}
              className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"
            >
              <CheckCircle className="w-12 h-12 text-green-500" />
            </motion.div>

            <h2 className={`text-xl font-bold mb-2 ${tc.text}`}>{t('send.txSuccessful')}</h2>
            <p className="text-2xl font-bold text-[#C7FF00] mb-1">
              {getCurrencySymbol(selectedCurrency)}{parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
            <p className={`text-sm ${tc.textMuted} mb-6`}>
              → {method === 'stablecoin' ? `${crypto.address.slice(0, 8)}...${crypto.address.slice(-6)}` : method === 'us_ach_wire' ? (selectedExternalAccount?.account_owner_name || 'External account') : resolvedName || accountNumber}
            </p>

            {/* Transaction details */}
            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 mb-6 text-left`}>
              {transactionRef && (
                <div className="flex justify-between items-center mb-2">
                  <span className={`text-xs ${tc.textMuted}`}>{t('send.reference')}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-mono ${tc.text}`}>{transactionRef}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(transactionRef);
                        toast.success(t('common.copied'));
                      }}
                    >
                      <Copy size={12} className={tc.textMuted} />
                    </button>
                  </div>
                </div>
              )}
              {transactionId && (
                <div className="flex justify-between items-center mb-2">
                  <span className={`text-xs ${tc.textMuted}`}>{t('send.transactionId')}</span>
                  <span className={`text-xs font-mono ${tc.text} truncate ml-4 max-w-[180px]`}>{transactionId}</span>
                </div>
              )}
              {newBalance !== null && (
                <div className="flex justify-between items-center">
                  <span className={`text-xs ${tc.textMuted}`}>{t('send.newBalance')}</span>
                  <span className={`text-sm font-semibold ${tc.text}`}>
                    {getCurrencySymbol(selectedCurrency)}{newBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={onComplete}
              className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98]"
            >
              {t('common.done')}
            </button>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 8: Error                                                      */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="px-5 py-10 text-center"
          >
            <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
              <XCircle className="w-12 h-12 text-red-500" />
            </div>
            <h2 className={`text-xl font-bold mb-2 ${tc.text}`}>{t('send.txFailed')}</h2>
            <p className={`text-sm ${tc.textMuted} mb-8 max-w-xs mx-auto`}>{errorMessage}</p>

            <div className="space-y-3">
              <button
                onClick={() => { setPin(''); setStep('pin'); }}
                className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98]"
              >
                {t('send.tryAgain')}
              </button>
              <button
                onClick={onBack}
                className={`w-full ${tc.card} border ${tc.borderLight} py-4 rounded-full font-bold ${tc.text} ${tc.hoverBg} transition-all active:scale-[0.98]`}
              >
                {t('common.cancel')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
