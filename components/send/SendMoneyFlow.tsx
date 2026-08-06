/**
 * BorderPay Africa - Send Money Flow (provider-backed payout rails)
 * Active transfer methods:
 *   1. External Bank Account (linked payout destination)
 *   2. Digital dollar withdrawal (external wallet address)
 *
 * Flow: Choose Method → Enter Details → Amount → Review → PIN → Success
 * i18n + theme-aware, neon green (#C7FF00) + black aesthetic
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Building2, Search,
  CheckCircle, AlertCircle, Lock, Loader2, ChevronDown,
  Info, ArrowRight, Copy, XCircle, Shield, Coins, Smartphone,
  Zap, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI, type ExternalWallet } from '../../utils/api/backendAPI';
import { PINManager, BiometricManager } from '../../utils/security/SecurityManager';
import { TransactionSecurityGate } from '../security/TransactionSecurityGate';
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
import { calculateYellowCardCustomerFee } from '../../utils/fees/yellowCard';
import { convertYellowCardLocalFeeToFunding } from '../../utils/fees/yellowCardMath';
import { classifyCorridor } from '../../utils/payouts/corridor';
import { isValidCryptoAddress, type CryptoWithdrawalValues } from '../payouts/ExternalCryptoWithdrawalFields';
import { TRANSFERS_LIVE, EXTERNAL_ACCOUNTS_LIVE } from '../../utils/featureFlags';
import { financialCacheKey } from '../../utils/financial/cacheScope';
import { navPerfTrackCache } from '../../utils/performance/navigationPerf';
import { canUseAfricanRails } from '../../utils/africanRailsAccess';
import {
  hasFreshAfricanPolicyRows,
  loadAfricanPolicyRows,
  readCachedAfricanPolicyRows,
  type AfricanPolicyRow,
  type AfricanRailChannel,
} from '../../utils/africanRailsPolicyCache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TransferMethod = 'us_ach_wire' | 'stablecoin' | AfricanRailChannel;
type Step = 'method' | 'africa-destination' | 'africa-rail' | 'crypto-wallet' | 'details' | 'amount' | 'review' | 'security-gate' | 'pin' | 'processing' | 'success' | 'error';

type AfricanCountryOption = {
  countryCode: string;
  countryName: string;
  flag: string;
  currencies: string[];
  rows: AfricanPolicyRow[];
};

const UI_CRYPTO_MIN_GROSS_USD = 5.0;
const AFRICAN_POLICY_REQUEST_TIMEOUT_MS = 6500;

function normalizeCryptoRoute(network?: string, token?: string): CryptoWithdrawalValues {
  const n = String(network || '').toLowerCase();
  const t = String(token || '').toUpperCase();
  if (n === 'tron') return { network: 'tron', token: 'USDT', address: '' };
  if (n === 'base') return { network: 'base', token: 'USDC', address: '' };
  if (t === 'USDT') return { network: 'tron', token: 'USDT', address: '' };
  return { network: 'base', token: 'USDC', address: '' };
}

function cryptoRouteLabel(values: CryptoWithdrawalValues): string {
  if (values.network === 'tron') return 'USDT on TRON';
  return 'USDC on Base';
}

function cryptoMinimumMessage(values: CryptoWithdrawalValues): string {
  return `Minimum gross payout in app is $${UI_CRYPTO_MIN_GROSS_USD.toFixed(2)} (${cryptoRouteLabel(values)}).`;
}

function mapCryptoTransferError(code: string | undefined, fallback: string | undefined, crypto: CryptoWithdrawalValues): string {
  if (code === 'insufficient_balance') {
    return 'Insufficient balance for this payout. Reduce the amount or add funds before trying again.';
  }
  if (code === 'balance_check_unavailable') {
    return 'We could not verify your wallet balance right now. Please retry shortly.';
  }
  if (code === 'unsupported_crypto_route') {
    return 'Only USDC on Base and USDT on TRON are supported right now.';
  }
  if (code === 'gross_below_minimum' || code === 'dust_minimum_not_met') {
    return cryptoMinimumMessage(crypto);
  }
  if (code === 'chain_mismatch' || code === 'currency_mismatch') {
    return 'Source and destination must use the same allowed route (USDC/Base or USDT/TRON).';
  }
  return fallback || 'Transfer failed. Please review your payout route and amount.';
}

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
  sandbox?: boolean;
}

interface ExternalAccountOption {
  id: string;
  bridge_external_account_id: string;
  account_type: 'us' | 'iban' | 'gb';
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

const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: '₦', KES: 'KSh', GHS: '₵', UGX: 'USh',
  XAF: 'FCFA', XOF: 'FCFA', TZS: 'TSh', USD: '$',
  SLE: 'Le', MZN: 'MT', MWK: 'MK', BWP: 'P', CDF: 'FC',
  RWF: 'FRw', ZAR: 'R', ZMW: 'K',
  USDT: '$', USDC: '$', PYUSD: '$',
};

function getCurrencySymbol(code: string) {
  return CURRENCY_SYMBOLS[code] || code;
}

function RouteIcon({ method }: { method: string }) {
  if (method.toLowerCase().includes('bank')) return <Building2 className="h-4 w-4" />;
  return <Smartphone className="h-4 w-4" />;
}

function flagFromCountryCode(countryCode: string) {
  const code = String(countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '🌍';
  return code
    .split('')
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
}

function countryNameFromCode(countryCode: string) {
  const code = String(countryCode || '').trim().toUpperCase();
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

function buildAfricanCountries(rows: AfricanPolicyRow[]): AfricanCountryOption[] {
  const grouped = new Map<string, AfricanPolicyRow[]>();
  rows.forEach((row) => {
    const current = grouped.get(row.countryCode) || [];
    current.push(row);
    grouped.set(row.countryCode, current);
  });
  return [...grouped.entries()]
    .map(([countryCode, countryRows]) => ({
      countryCode,
      countryName: countryNameFromCode(countryCode),
      flag: flagFromCountryCode(countryCode),
      currencies: [...new Set(countryRows.map((row) => row.currency))],
      rows: countryRows,
    }))
    .sort((a, b) => a.countryName.localeCompare(b.countryName));
}

function getRailOptions(country?: AfricanCountryOption | null) {
  if (!country) return [];
  const grouped = new Map<AfricanRailChannel, AfricanPolicyRow[]>();
  country.rows.forEach((row) => {
    const current = grouped.get(row.channel) || [];
    current.push(row);
    grouped.set(row.channel, current);
  });
  return [...grouped.entries()].map(([channel, rows]) => {
    const sorted = [...rows].sort((a, b) => b.priority - a.priority || a.currency.localeCompare(b.currency));
    const preferred = sorted.find((row) => row.currency !== 'USD') || sorted[0];
    return { channel, rows, currency: preferred.currency };
  });
}

function policyRouteCode(rail?: { rows: AfricanPolicyRow[] } | null) {
  const row = rail?.rows?.[0];
  return String(row?.raw?.provider_bank_code || row?.raw?.provider_network_id || row?.raw?.route_code || row?.channel || 'local_rail');
}

function policyRouteName(channel: AfricanRailChannel) {
  return channel === 'bank' ? 'Local bank transfer' : 'Mobile money transfer';
}

function railLabel(channel: AfricanRailChannel) {
  return channel === 'bank' ? 'Local bank' : 'Mobile money';
}

function railDescription(channel: AfricanRailChannel, countryName: string) {
  return channel === 'bank'
    ? `Send to a bank account in ${countryName}`
    : `Send to a mobile wallet in ${countryName}`;
}

function CorridorFlag({ flag }: { flag: string }) {
  return (
    <div
      className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-black"
      aria-hidden="true"
    >
      <span className="text-[30px] leading-none">{flag}</span>
    </div>
  );
}

const SEND_WALLETS_CACHE_KEY = 'borderpay_send_wallets_v1';
const SEND_CAPS_CACHE_KEY = 'borderpay_send_caps_v1';
const EXTERNAL_ACCOUNTS_CACHE_KEY = 'borderpay_payout_accounts_v1';
const EXTERNAL_WALLETS_CACHE_KEY = 'borderpay_external_wallets_v2';
const SEND_ROUTE_REFRESH_TS_KEY = 'borderpay_send_refresh_ts_v1';
const AFRICAN_FUNDING_CURRENCY_PRIORITY = ['USDC', 'USDT'];
const BRIDGE_WALLET_FUNDING_CURRENCY_PRIORITY = ['USDC', 'USDT'];

function selectAfricanFundingWallet(wallets: Wallet[]) {
  const normalizedWallets = wallets.map((wallet) => ({
    ...wallet,
    currency: String(wallet.currency || '').toUpperCase(),
  }));
  for (const currency of AFRICAN_FUNDING_CURRENCY_PRIORITY) {
    const wallet = normalizedWallets.find((w) => w.currency === currency && Number(w.balance) > 0);
    if (wallet) return wallet;
  }
  return normalizedWallets.find((w) => AFRICAN_FUNDING_CURRENCY_PRIORITY.includes(w.currency)) || null;
}

function formatMoney(amount: number, currency: string, options?: Intl.NumberFormatOptions) {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return `${getCurrencySymbol(currency)}${safeAmount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  })}`;
}

function displayMoneyCurrency(currency: string) {
  const c = String(currency || '').toUpperCase();
  return c === 'USDC' || c === 'USDT' ? 'USD' : c;
}

function routeDeveloperFeePercent(wallet: ExternalWallet | null | undefined): number {
  const raw = wallet?.bridge_payment_route_raw;
  const candidates = [
    raw?.developer_fee_percent,
    raw?.payment_route?.developer_fee_percent,
    raw?.features?.developer_fee_percent,
  ];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return num;
  }
  return 0;
}

function formatDisplayMoney(amount: number, currency: string, options?: Intl.NumberFormatOptions) {
  return formatMoney(amount, displayMoneyCurrency(currency), options);
}

function providerSettlementCurrencyForAfricanRail(sourceCurrency: string) {
  const c = String(sourceCurrency || '').trim().toUpperCase();
  return c === 'USDC' || c === 'USDT' ? 'USD' : c;
}

const COUNTRY_DIAL_CODES: Record<string, string> = {
  BJ: '229', BW: '267', BF: '226', CM: '237', CI: '225', CD: '243',
  CG: '242', TD: '235', GA: '241', TG: '228',
  EG: '20', ET: '251', GH: '233', GN: '224', KE: '254', MW: '265',
  ML: '223', MA: '212', MZ: '258', NG: '234', RW: '250', SN: '221',
  SL: '232', ZA: '27', TZ: '255', UG: '256', ZM: '260',
};

function formatInternationalPhone(raw: string, countryCode: string) {
  const trimmed = String(raw || '').trim();
  if (trimmed.startsWith('+')) return `+${trimmed.replace(/\D/g, '')}`;
  const digits = trimmed.replace(/\D/g, '');
  const dial = COUNTRY_DIAL_CODES[String(countryCode || '').toUpperCase()];
  if (!dial || !digits) return digits;
  if (digits.startsWith(dial)) return `+${digits}`;
  return `+${dial}${digits.replace(/^0+/, '')}`;
}

function isLikelyInternationalPhone(raw: string, countryCode: string) {
  const phone = formatInternationalPhone(raw, countryCode);
  const dial = COUNTRY_DIAL_CODES[String(countryCode || '').toUpperCase()];
  return Boolean(dial && phone.startsWith(`+${dial}`) && phone.length >= dial.length + 7);
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapePdfText(value: unknown) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\r\n]+/g, ' ');
}

function buildReceiptPdf(lines: Array<{ label?: string; value: string; large?: boolean }>) {
  const content: string[] = [
    'BT',
    '/F1 20 Tf',
    '72 760 Td',
    '(BorderPay Africa) Tj',
  ];
  let yGap = 34;
  lines.forEach((line) => {
    content.push(`0 -${yGap} Td`);
    if (line.label) {
      content.push('/F1 10 Tf');
      content.push(`(${escapePdfText(line.label)}) Tj`);
      content.push('0 -16 Td');
    }
    content.push(line.large ? '/F1 24 Tf' : '/F1 12 Tf');
    content.push(`(${escapePdfText(line.value)}) Tj`);
    yGap = line.large ? 34 : 28;
  });
  content.push('ET');
  const stream = content.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function nestedValue(input: any, path: string) {
  return path.split('.').reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), input);
}

function extractAfricanQuote(input: any, sourceAmount: number) {
  const rates = input?.rates ?? input;
  const providerRateRows = Array.isArray(rates?.rates)
    ? rates.rates
    : (Array.isArray(rates?.data) ? rates.data : (Array.isArray(rates) ? rates : []));
  const providerRate = providerRateRows.find((row: any) =>
    String(row?.code || '').toUpperCase() === String(input?.destination_currency || '').toUpperCase()
  ) || providerRateRows[0];
  const destinationAmount = firstFiniteNumber(
    nestedValue(rates, 'destination_amount'),
    nestedValue(rates, 'destinationAmount'),
    nestedValue(rates, 'recipient_amount'),
    nestedValue(rates, 'recipientAmount'),
    nestedValue(rates, 'amount_to_receive'),
    nestedValue(rates, 'to_amount'),
    nestedValue(rates, 'converted_amount'),
    nestedValue(rates, 'destination.amount'),
    nestedValue(rates, 'quote.destination_amount'),
    nestedValue(rates, 'data.destination_amount'),
  );
  const rate = firstFiniteNumber(
    nestedValue(rates, 'rate'),
    nestedValue(rates, 'exchange_rate'),
    nestedValue(rates, 'fx_rate'),
    nestedValue(rates, 'conversion_rate'),
    nestedValue(rates, 'transfer_rate'),
    nestedValue(rates, 'data.rate'),
    providerRate?.sell,
  );
  const fee = firstFiniteNumber(
    nestedValue(rates, 'fee'),
    nestedValue(rates, 'fees.total'),
    nestedValue(rates, 'transfer_fee'),
    nestedValue(rates, 'data.fee'),
  );
  return {
    destinationAmount: destinationAmount || (rate ? sourceAmount * rate : null),
    rate,
    fee,
  };
}

function numberFromRaw(row: AfricanPolicyRow | null | undefined, key: string) {
  const n = Number(row?.raw?.[key]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function providerFromPolicy(row: AfricanPolicyRow | null | undefined) {
  return String(row?.provider || row?.raw?.provider || '').trim().toLowerCase();
}

function walletRouteKey(asset: string, chain: string) {
  return `${String(asset || '').toUpperCase()}:${String(chain || '').toLowerCase()}`;
}

function isSupportedExternalWallet(wallet: Pick<ExternalWallet, 'asset' | 'chain'>) {
  const key = walletRouteKey(wallet.asset, wallet.chain);
  return key === 'USDC:base' || key === 'USDT:tron';
}

function chainDisplayName(chain: string) {
  const c = String(chain || '').toLowerCase();
  if (c === 'base') return 'Base';
  if (c === 'tron') return 'TRON';
  return chain;
}

function shortAddress(address: string) {
  const a = String(address || '');
  return a.length > 16 ? `${a.slice(0, 8)}...${a.slice(-6)}` : a;
}

function localRailQuoteError(error: unknown) {
  const raw = String((error as any)?.message || error || '').trim();
  if (!raw) return 'Unable to quote this corridor right now. Please try again.';
  if (/(yellow\s*card|provider|http\s*\d+|upstream|api)/i.test(raw)) {
    return 'Unable to quote this corridor right now. Please try again.';
  }
  return friendlyError(raw, 'Unable to quote this corridor right now. Please try again.');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SendMoneyFlow({ userId, onBack, onComplete, onNavigate }: SendMoneyFlowProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const snapshotReader = backendAPI.financial.getSnapshot;
  void snapshotReader;

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
  const africanRailsTester = useMemo(() => {
    try {
      const stored = localStorage.getItem('borderpay_user');
      const user = stored ? JSON.parse(stored) : {};
      return canUseAfricanRails({ id: userId || user?.id, email: user?.email });
    } catch {
      return canUseAfricanRails({ id: userId });
    }
  }, [userId]);

  const sendWalletsCacheKey = useMemo(
    () => financialCacheKey(SEND_WALLETS_CACHE_KEY, { userId }),
    [userId],
  );
  const sendCapsCacheKey = useMemo(
    () => financialCacheKey(SEND_CAPS_CACHE_KEY, { userId }),
    [userId],
  );
  const sendRefreshTsKey = useMemo(
    () => financialCacheKey(SEND_ROUTE_REFRESH_TS_KEY, { userId }),
    [userId],
  );
  const cachedSendWallets = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(sendWalletsCacheKey) || '[]'); } catch { return []; }
  }, [sendWalletsCacheKey]);
  const cachedSendCaps = useMemo(() => {
    try { const v = JSON.parse(localStorage.getItem(sendCapsCacheKey) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }, [sendCapsCacheKey]);
  const externalAccountsCacheKey = useMemo(
    () => financialCacheKey(EXTERNAL_ACCOUNTS_CACHE_KEY, { userId }),
    [userId],
  );
  const externalWalletsCacheKey = useMemo(
    () => financialCacheKey(EXTERNAL_WALLETS_CACHE_KEY, { userId }),
    [userId],
  );
  const cachedExternalAccounts = useMemo(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(externalAccountsCacheKey) || '[]');
      return Array.isArray(raw)
        ? raw.filter((x: any) =>
          ['us', 'iban', 'gb'].includes(String(x?.account_type || '').toLowerCase())
          && ['USD', 'EUR', 'GBP'].includes(String(x?.currency || '').toUpperCase())
          && String(x?.bridge_external_account_id || '').trim()
        )
        : [];
    } catch {
      return [];
    }
  }, [externalAccountsCacheKey]);
  const cachedExternalWallets = useMemo(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(externalWalletsCacheKey) || '[]');
      return Array.isArray(raw) ? raw.filter(isSupportedExternalWallet) : [];
    } catch {
      return [];
    }
  }, [externalWalletsCacheKey]);
  useEffect(() => {
    navPerfTrackCache('send-money', cachedSendWallets.length > 0 || cachedSendCaps.length > 0 || cachedExternalAccounts.length > 0 || cachedExternalWallets.length > 0);
  }, [cachedSendWallets.length, cachedSendCaps.length, cachedExternalAccounts.length, cachedExternalWallets.length]);

  // Step & method
  const [step, setStep] = useState<Step>('method');
  const [method, setMethod] = useState<TransferMethod>('stablecoin');
  const [africanPolicyRows, setAfricanPolicyRows] = useState<AfricanPolicyRow[]>(() => readCachedAfricanPolicyRows('payout'));
  const [africanPolicyLoading, setAfricanPolicyLoading] = useState(false);
  const africanPolicyLoadingRef = useRef(false);
  const [africanPolicyError, setAfricanPolicyError] = useState('');
  const [selectedAfricanCountryCode, setSelectedAfricanCountryCode] = useState('');
  const [selectedAfricanRail, setSelectedAfricanRail] = useState<{
    channel: AfricanRailChannel;
    currency: string;
    rows: AfricanPolicyRow[];
  } | null>(null);

  const loadAfricanPolicy = useCallback(async (force = false) => {
    if (africanPolicyLoadingRef.current) return;
    const cacheIsFresh = hasFreshAfricanPolicyRows('payout');
    if (!force && africanPolicyRows.length > 0 && cacheIsFresh) return;
    africanPolicyLoadingRef.current = true;
    setAfricanPolicyLoading(africanPolicyRows.length === 0);
    setAfricanPolicyError('');
    try {
      const rows = await loadAfricanPolicyRows('payout', {
        force: force || !cacheIsFresh,
        timeoutMs: AFRICAN_POLICY_REQUEST_TIMEOUT_MS,
      });
      setAfricanPolicyRows(rows);
    } catch (error: any) {
      if (africanPolicyRows.length === 0 || !cacheIsFresh) setAfricanPolicyRows([]);
      setAfricanPolicyError(friendlyError(error?.message, 'Unable to load African rails.'));
    } finally {
      africanPolicyLoadingRef.current = false;
      setAfricanPolicyLoading(false);
    }
  }, [africanPolicyRows.length]);

  useEffect(() => {
    const cacheIsFresh = hasFreshAfricanPolicyRows('payout');
    if (africanPolicyRows.length > 0 && cacheIsFresh) return;
    let active = true;
    void loadAfricanPolicyRows('payout', {
      force: !cacheIsFresh,
      timeoutMs: AFRICAN_POLICY_REQUEST_TIMEOUT_MS,
    })
      .then((rows) => {
        if (!active) return;
        setAfricanPolicyRows(rows);
        setAfricanPolicyError('');
      })
      .catch(() => {
        if (active && !cacheIsFresh) setAfricanPolicyRows([]);
        // The visible Africa step owns user-facing retry/error state.
      });
    return () => {
      active = false;
    };
  }, [africanPolicyRows.length]);

  useEffect(() => {
    if (step === 'africa-destination' || step === 'africa-rail') {
      void loadAfricanPolicy();
    }
  }, [step, loadAfricanPolicy]);

  // Currency & wallet
  const [wallets, setWallets] = useState<Wallet[]>(cachedSendWallets);
  const walletsRef = useRef<Wallet[]>(cachedSendWallets);
  const [selectedCurrency, setSelectedCurrency] = useState('USDC');
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  // Bank / MoMo details
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [selectedBank, setSelectedBank] = useState<Institution | null>(null);
  const [bankSearch, setBankSearch] = useState('');
  const [showBankList, setShowBankList] = useState(false);
  const [accountNumber, setAccountNumber] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [resolvedName, setResolvedName] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');

  // External bank payout state (Bridge external accounts)
  const [externalAccounts, setExternalAccounts] = useState<ExternalAccountOption[]>(cachedExternalAccounts);
  const externalAccountsRef = useRef<ExternalAccountOption[]>(cachedExternalAccounts);
  const [selectedExternalAccountId, setSelectedExternalAccountId] = useState<string>(
    String(cachedExternalAccounts?.[0]?.bridge_external_account_id || ''),
  );
  const [usMemo, setUsMemo] = useState('');

  // External stablecoin withdrawal — network + token + destination address.
  const [crypto, setCrypto] = useState<CryptoWithdrawalValues>({ network: 'base', token: 'USDC', address: '' });
  const [cryptoSavedRouteId, setCryptoSavedRouteId] = useState('');
  const [cryptoSavedWalletId, setCryptoSavedWalletId] = useState('');
  const [externalWallets, setExternalWallets] = useState<ExternalWallet[]>(cachedExternalWallets);
  const [externalWalletsLoading, setExternalWalletsLoading] = useState(false);
  const [externalWalletsError, setExternalWalletsError] = useState('');
  const selectedCryptoRouteKey = walletRouteKey(crypto.token, crypto.network);
  const filteredExternalWallets = useMemo(
    () => externalWallets
      .filter(isSupportedExternalWallet)
      .filter((wallet) => walletRouteKey(wallet.asset, wallet.chain) === selectedCryptoRouteKey),
    [externalWallets, selectedCryptoRouteKey],
  );
  const selectedCryptoExternalWallet = useMemo(
    () => externalWallets.find((wallet) => String(wallet.id || '') === cryptoSavedWalletId) || null,
    [externalWallets, cryptoSavedWalletId],
  );
  const cryptoRouteDetailsReady = method !== 'stablecoin'
    || Boolean(
      cryptoSavedWalletId
      && cryptoSavedRouteId
      && selectedCryptoExternalWallet
      && selectedCryptoExternalWallet.bridge_payment_route_raw
    );
  const cryptoRouteDetailsError = method === 'stablecoin' && cryptoSavedWalletId && cryptoSavedRouteId && !cryptoRouteDetailsReady
    ? (externalWalletsLoading ? 'Loading withdrawal route details...' : 'Refresh this saved withdrawal wallet before sending.')
    : '';

  const loadExternalWallets = useCallback(async () => {
    setExternalWalletsLoading(externalWallets.length === 0);
    setExternalWalletsError('');
    try {
      const response: any = await backendAPI.externalWallets.list();
      if (!response?.success) throw new Error(response?.error || 'Could not load withdrawal wallets.');
      const next = Array.isArray(response?.data?.wallets)
        ? response.data.wallets.filter(isSupportedExternalWallet)
        : [];
      setExternalWallets(next);
      try { localStorage.setItem(externalWalletsCacheKey, JSON.stringify(next)); } catch { /* cache best effort */ }
    } catch (error: any) {
      setExternalWalletsError(friendlyError(error?.message, 'Could not load withdrawal wallets.'));
    } finally {
      setExternalWalletsLoading(false);
    }
  }, [externalWallets.length, externalWalletsCacheKey]);

  const selectExternalWallet = useCallback((wallet: ExternalWallet) => {
    const normalized = normalizeCryptoRoute(wallet.chain, wallet.asset);
    setMethod('stablecoin');
    setSelectedCurrency(normalized.token);
    setCrypto({ ...normalized, address: String(wallet.address || '') });
    setCryptoSavedRouteId(String(wallet.bridge_payment_route_id || ''));
    setCryptoSavedWalletId(String(wallet.id || ''));
    setStep('amount');
  }, []);

  useEffect(() => {
    if (step === 'crypto-wallet') {
      void loadExternalWallets();
    }
  }, [step, loadExternalWallets]);

  useEffect(() => {
    if (method === 'stablecoin' && cryptoSavedWalletId && !cryptoRouteDetailsReady) {
      void loadExternalWallets();
    }
  }, [method, cryptoSavedWalletId, cryptoRouteDetailsReady, loadExternalWallets]);

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
        const normalized = normalizeCryptoRoute(String(p.chain), token);
        if (p.external_wallet_id && !externalWallets.some((wallet) => String(wallet.id || '') === String(p.external_wallet_id))) {
          const walletFromPrefill = {
            id: String(p.external_wallet_id),
            label: String(p.label || `${token} withdrawal wallet`),
            chain: normalized.network,
            asset: normalized.token,
            address: String(p.address),
            bridge_payment_route_id: String(p.bridge_payment_route_id || ''),
            bridge_payment_route_status: String(p.bridge_payment_route_status || 'active'),
            bridge_payment_route_raw: p.bridge_payment_route_raw || null,
            created_at: String(p.created_at || new Date().toISOString()),
          } as ExternalWallet;
          setExternalWallets((current) => {
            const next = [walletFromPrefill, ...current.filter((wallet) => String(wallet.id || '') !== walletFromPrefill.id)];
            try { localStorage.setItem(externalWalletsCacheKey, JSON.stringify(next)); } catch { /* cache best effort */ }
            return next;
          });
        }
        setMethod('stablecoin');
        setSelectedCurrency(normalized.token);
        setCrypto({ ...normalized, address: String(p.address) });
        setCryptoSavedRouteId(String(p.bridge_payment_route_id || ''));
        setCryptoSavedWalletId(String(p.external_wallet_id || ''));
        setStep('amount');
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

  // Provider-backed capability gate for external bank accounts.
  const [externalAccountTypes, setExternalAccountTypes] = useState<Array<'us' | 'iban' | 'gb'>>(
    cachedSendCaps.filter((x: any) => x === 'us' || x === 'iban' || x === 'gb')
  );
  const selectedExternalAccount = useMemo(
    () => externalAccounts.find((x) => x.bridge_external_account_id === selectedExternalAccountId) || null,
    [externalAccounts, selectedExternalAccountId],
  );
  const isAfricanPayout = method === 'bank' || method === 'mobile_money';
  const isExternalAccountOfframp = method === 'us_ach_wire';
  const [selectedAfricanFundingCurrency, setSelectedAfricanFundingCurrency] = useState('');
  const [selectedExternalFundingCurrency, setSelectedExternalFundingCurrency] = useState('');
  const africanFundingWallets = useMemo(
    () => (africanRailsTester ? [
      { id: 'yellow-card-sandbox-usdc', currency: 'USDC', balance: 100000, sandbox: true },
      { id: 'yellow-card-sandbox-usdt', currency: 'USDT', balance: 100000, sandbox: true },
    ] : wallets)
      .map((wallet) => ({ ...wallet, currency: String(wallet.currency || '').toUpperCase() }))
      .filter((wallet) => AFRICAN_FUNDING_CURRENCY_PRIORITY.includes(wallet.currency))
      .sort((a, b) => AFRICAN_FUNDING_CURRENCY_PRIORITY.indexOf(a.currency) - AFRICAN_FUNDING_CURRENCY_PRIORITY.indexOf(b.currency)),
    [africanRailsTester, wallets],
  );
  const externalFundingWallets = useMemo(
    () => wallets
      .map((wallet) => ({ ...wallet, currency: String(wallet.currency || '').toUpperCase() }))
      .filter((wallet) => BRIDGE_WALLET_FUNDING_CURRENCY_PRIORITY.includes(wallet.currency))
      .sort((a, b) => BRIDGE_WALLET_FUNDING_CURRENCY_PRIORITY.indexOf(a.currency) - BRIDGE_WALLET_FUNDING_CURRENCY_PRIORITY.indexOf(b.currency)),
    [wallets],
  );
  const activeFundingWallet = useMemo(() => {
    if (!isAfricanPayout) return selectedWallet;
    return africanFundingWallets.find((wallet) => wallet.currency === selectedAfricanFundingCurrency)
      || selectAfricanFundingWallet(africanFundingWallets)
      || africanFundingWallets[0]
      || null;
  }, [africanFundingWallets, isAfricanPayout, selectedAfricanFundingCurrency, selectedWallet]);
  const activeExternalFundingWallet = useMemo(() => {
    if (!isExternalAccountOfframp) return selectedWallet;
    return externalFundingWallets.find((wallet) => wallet.currency === selectedExternalFundingCurrency)
      || selectAfricanFundingWallet(externalFundingWallets)
      || externalFundingWallets[0]
      || null;
  }, [externalFundingWallets, isExternalAccountOfframp, selectedExternalFundingCurrency, selectedWallet]);
  const activeFundingCurrency = activeFundingWallet?.currency || selectedCurrency;
  const activeExternalFundingCurrency = activeExternalFundingWallet?.currency || 'USDC';
  const amountCurrency = isAfricanPayout ? activeFundingCurrency : isExternalAccountOfframp ? activeExternalFundingCurrency : selectedCurrency;
  const africanCountries = useMemo(
    () => buildAfricanCountries(africanPolicyRows),
    [africanPolicyRows],
  );
  const selectedAfricanCountry = useMemo(
    () => africanCountries.find((country) => country.countryCode === selectedAfricanCountryCode) || null,
    [africanCountries, selectedAfricanCountryCode],
  );
  const selectedAfricanRailOptions = useMemo(
    () => getRailOptions(selectedAfricanCountry),
    [selectedAfricanCountry],
  );
  const africanRailCount = africanPolicyRows.length;
  const selectedAfricanPolicyRow = useMemo(() => {
    if (!selectedAfricanRail) return null;
    const rows = selectedAfricanRail.rows.filter((row) => row.currency === selectedCurrency && row.channel === selectedAfricanRail.channel);
    if (!rows.length) return selectedAfricanRail.rows[0] || null;
    const amountNumber = Number(amount);
    const hasAmount = Number.isFinite(amountNumber) && amountNumber > 0;
    return [...rows].sort((a, b) => {
      const feeFor = (row: AfricanPolicyRow) => {
        const pct = numberFromRaw(row, 'provider_fee_percent');
        const usd = numberFromRaw(row, 'provider_fee_usd');
        const local = numberFromRaw(row, 'provider_fee_local');
        if (hasAmount && pct !== null) return (amountNumber * pct) / 100;
        if (usd !== null) return usd;
        if (local !== null) return local;
        return Number.POSITIVE_INFINITY;
      };
      const af = feeFor(a);
      const bf = feeFor(b);
      if (af !== bf) return af - bf;
      return b.priority - a.priority;
    })[0] || null;
  }, [amount, selectedAfricanRail, selectedCurrency]);
  const selectedAfricanProvider = providerFromPolicy(selectedAfricanPolicyRow);
  const requiresInstitutionSelection = isAfricanPayout && selectedAfricanProvider === 'yellow_card' && africanRailsTester;
  const [africanQuote, setAfricanQuote] = useState<{
    destinationAmount: number | null;
    rate: number | null;
    fee: number | null;
  } | null>(null);
  const [africanQuoteLoading, setAfricanQuoteLoading] = useState(false);
  const [africanQuoteError, setAfricanQuoteError] = useState('');
  const [yellowCardSandboxOutcome, setYellowCardSandboxOutcome] = useState<'success' | 'failure'>('success');
  const africanQuoteReqRef = useRef(0);

  // Instant fallback fee — shown immediately on first paint.
  const fallbackNetworkFee = useMemo(() => {
    const num = parseFloat(amount);
    if (!num || num <= 0) return null;
    if (isAfricanPayout) return null;
    if (method === 'stablecoin') {
      const feePercent = routeDeveloperFeePercent(selectedCryptoExternalWallet);
      const totalFee = feePercent > 0 ? (num * feePercent) / 100 : 0;
      const free = computePayoutFee({ corridor: 'stablecoin', accountType, amount: num, passThroughCost: 0 });
      return {
        ...free,
        feePercent,
        percentFee: totalFee,
        totalFee,
        netAmount: Math.max(0, num - totalFee),
        breakdown: [{ label: 'Transaction fee', amount: totalFee }],
      };
    }
    const country = SUPPORTED_CURRENCIES.find(c => c.code === selectedCurrency)?.country;
    const corridor: 'international' | 'stablecoin' =
      method === 'us_ach_wire'
          ? 'international'                                    // ACH/SEPA external bank
          : (classifyCorridor(country) === 'african' ? 'stablecoin' : 'international');
    return computePayoutFee({ corridor, accountType, amount: num, passThroughCost: 0 });
  }, [amount, selectedCurrency, accountType, method, isAfricanPayout, selectedCryptoExternalWallet]);
  useEffect(() => {
    const num = parseFloat(amount);
    if (!isAfricanPayout || !selectedAfricanCountryCode || !selectedAfricanRail || !activeFundingCurrency || !Number.isFinite(num) || num <= 0) {
      setAfricanQuote(null);
      setAfricanQuoteLoading(false);
      setAfricanQuoteError('');
      return;
    }
    if (!africanRailsTester) {
      setAfricanQuote(null);
      setAfricanQuoteLoading(false);
      setAfricanQuoteError('This route remains in controlled integration testing.');
      return;
    }
    const reqId = africanQuoteReqRef.current + 1;
    africanQuoteReqRef.current = reqId;
    setAfricanQuoteLoading(true);
    setAfricanQuoteError('');
    (async () => {
      try {
        const res: any = await backendAPI.payouts.yellowCardCapabilities('rates', {
          currency: selectedCurrency,
          country: selectedAfricanCountryCode,
          amount: num,
        });
        if (africanQuoteReqRef.current !== reqId) return;
        if (!res?.success || !res?.data) {
          throw new Error(res?.error || 'Unable to quote this corridor.');
        }
        const quote = extractAfricanQuote(res.data, num);
        if (!quote.destinationAmount) {
          throw new Error('Provider quote did not include a destination amount.');
        }
        setAfricanQuote(quote);
      } catch (error: any) {
        if (africanQuoteReqRef.current !== reqId) return;
        setAfricanQuote(null);
        setAfricanQuoteError(localRailQuoteError(error));
      } finally {
        if (africanQuoteReqRef.current === reqId) setAfricanQuoteLoading(false);
      }
    })();
  }, [amount, isAfricanPayout, selectedAfricanCountryCode, selectedAfricanRail, selectedCurrency, activeFundingCurrency, africanRailsTester]);

  const africanPolicyFee = useMemo(() => {
    if (!isAfricanPayout || !selectedAfricanPolicyRow || !africanQuote?.destinationAmount) return null;
    const executionLocalAmount = Math.round(africanQuote.destinationAmount);
    const fee = calculateYellowCardCustomerFee(selectedAfricanPolicyRow, executionLocalAmount);
    return fee ? {
      amount: fee.customerAmount,
      currency: selectedCurrency,
      percent: fee.effectivePercent,
      basisAmount: executionLocalAmount,
    } : null;
  }, [africanQuote?.destinationAmount, isAfricanPayout, selectedAfricanPolicyRow, selectedCurrency]);

  const networkFee = fallbackNetworkFee;
  const [limitError, setLimitError] = useState<string | null>(null);
  const sourceAmount = useMemo(() => {
    const num = parseFloat(amount);
    return Number.isFinite(num) && num > 0 ? num : 0;
  }, [amount]);
  const africanFeeInFundingCurrency = useMemo(() => {
    if (!isAfricanPayout || !africanPolicyFee || sourceAmount <= 0) return 0;
    if (africanPolicyFee.currency === activeFundingCurrency) {
      return Number.isFinite(africanPolicyFee.amount) && africanPolicyFee.amount > 0 ? africanPolicyFee.amount : 0;
    }
    const destinationAmount = Number(africanPolicyFee.basisAmount || 0);
    if (destinationAmount <= 0 || africanPolicyFee.currency !== selectedCurrency) return 0;
    return convertYellowCardLocalFeeToFunding(africanPolicyFee.amount, destinationAmount, sourceAmount);
  }, [activeFundingCurrency, africanPolicyFee, isAfricanPayout, selectedCurrency, sourceAmount]);
  const africanTotalSourceDebit = sourceAmount + africanFeeInFundingCurrency;
  const africanComputedRate = useMemo(() => {
    if (!isAfricanPayout || sourceAmount <= 0) return null;
    if (africanQuote?.rate && Number.isFinite(africanQuote.rate) && africanQuote.rate > 0) return africanQuote.rate;
    if (africanQuote?.destinationAmount && africanQuote.destinationAmount > 0) return africanQuote.destinationAmount / sourceAmount;
    return null;
  }, [africanQuote, isAfricanPayout, sourceAmount]);
  const africanInsufficientFunding = isAfricanPayout
    && !!activeFundingWallet
    && sourceAmount > 0
    && africanTotalSourceDebit > Number(activeFundingWallet.balance || 0);

  useEffect(() => {
    if (!isAfricanPayout) return;
    if (!africanFundingWallets.length) {
      if (selectedAfricanFundingCurrency) setSelectedAfricanFundingCurrency('');
      return;
    }
    if (africanFundingWallets.some((wallet) => wallet.currency === selectedAfricanFundingCurrency)) return;
    const preferred = africanFundingWallets.find((wallet) => wallet.currency === 'USDC')
      || africanFundingWallets.find((wallet) => Number(wallet.balance) > 0)
      || africanFundingWallets[0];
    setSelectedAfricanFundingCurrency(preferred.currency);
  }, [africanFundingWallets, isAfricanPayout, selectedAfricanFundingCurrency]);

  useEffect(() => {
    if (!isExternalAccountOfframp) return;
    if (!externalFundingWallets.length) {
      if (selectedExternalFundingCurrency) setSelectedExternalFundingCurrency('');
      return;
    }
    if (externalFundingWallets.some((wallet) => wallet.currency === selectedExternalFundingCurrency)) return;
    const preferred = externalFundingWallets.find((wallet) => wallet.currency === 'USDC')
      || externalFundingWallets.find((wallet) => Number(wallet.balance) > 0)
      || externalFundingWallets[0];
    setSelectedExternalFundingCurrency(preferred.currency);
  }, [externalFundingWallets, isExternalAccountOfframp, selectedExternalFundingCurrency]);

  // PIN & result
  const [pin, setPin] = useState('');
  const [snapshotReady, setSnapshotReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingInstitutions, setLoadingInstitutions] = useState(false);
  const institutionsLoadInFlightRef = useRef<Promise<void> | null>(null);
  const [transactionId, setTransactionId] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [newBalance, setNewBalance] = useState<number | null>(null);
  const institutionsCacheKey = useMemo(
    () => `borderpay_send_institutions_v1:${userId}:${method}:${selectedAfricanCountryCode}:${selectedCurrency}`,
    [userId, method, selectedAfricanCountryCode, selectedCurrency]
  );
  const institutionsRefreshTsKey = useMemo(
    () => `borderpay_send_institutions_refreshed_at:${userId}:${method}:${selectedAfricanCountryCode}:${selectedCurrency}`,
    [userId, method, selectedAfricanCountryCode, selectedCurrency]
  );
  const [hasPinFactor, setHasPinFactor] = useState(() => PINManager.hasPIN(userId));
  const [hasBiometricFactor, setHasBiometricFactor] = useState(() => BiometricManager.isEnrolled(userId));
  const hasAnyAuthFactor = hasPinFactor || hasBiometricFactor;
  useEffect(() => {
    let active = true;
    void Promise.all([
      backendAPI.auth.getSecurityStatus(userId),
      BiometricManager.isSupported(),
    ]).then(([security, biometricSupported]: any[]) => {
      if (!active) return;
      if (security?.success) setHasPinFactor(Boolean(security?.data?.pin_set));
      const serverBiometric = Boolean(security?.success && security?.data?.biometric_enrolled);
      if (serverBiometric) {
        try { localStorage.setItem('borderpay_biometric_enrolled', 'true'); } catch { /* preserve server truth without blocking */ }
      }
      setHasBiometricFactor(Boolean(biometricSupported && (serverBiometric || (!security?.success && BiometricManager.isEnrolled(userId)))));
    });
    return () => { active = false; };
  }, [userId]);
  // ---------------------------------------------------------------------------
  // Snapshot hydration:
  // - first paint comes from cache
  // - one immediate background refresh only
  // - no delayed retry loop that contends with route navigation
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const hydrateOnce = async (force = false) => {
      try {
        const hasCached = walletsRef.current.length > 0 || externalAccountsRef.current.length > 0;
        const last = Number(localStorage.getItem(sendRefreshTsKey) || '0');
        if (!force && hasCached && Number.isFinite(last) && Date.now() - last < 45_000) return;
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
                rawType === 'iban' || rawType === 'gb' ? rawType : 'us';
              const rawCurrency = String(row?.currency || '');
              const currency = rawCurrency
                ? rawCurrency.toUpperCase()
                : (accountType === 'iban' ? 'EUR' : accountType === 'gb' ? 'GBP' : 'USD');
              const externalId = String(row?.bridge_external_account_id || row?.external_account_id || row?.id || '');
              return {
                id: String(row?.id || externalId || `ext_${idx}`),
                bridge_external_account_id: externalId,
                account_type: accountType,
                currency,
                account_owner_name: row?.account_owner_name ?? null,
                bank_name: row?.bank_name ?? null,
                last_4: row?.last_4 ? String(row.last_4) : null,
                rail: row?.rail ?? (accountType === 'iban' ? 'sepa' : accountType === 'gb' ? 'faster_payments' : 'ach'),
                status: String(row?.status || 'active'),
              } as ExternalAccountOption;
            }).filter((x: ExternalAccountOption) =>
              !!x.bridge_external_account_id
              && ['us', 'iban', 'gb'].includes(x.account_type)
              && ['USD', 'EUR', 'GBP'].includes(String(x.currency || '').toUpperCase())
            )
          : [];
        setWallets(list);
        setExternalAccountTypes(types.filter((x: any) => x === 'us' || x === 'iban' || x === 'gb'));
        setExternalAccounts(ext);
        try { localStorage.setItem(externalAccountsCacheKey, JSON.stringify(ext)); } catch { /* noop */ }
        if (!selectedExternalAccountId && ext.length > 0) {
          setSelectedExternalAccountId(ext[0].bridge_external_account_id);
          if (ext[0]?.currency) setSelectedCurrency(ext[0].currency);
        }
        try { localStorage.setItem(sendWalletsCacheKey, JSON.stringify(list)); } catch { /* noop */ }
        try { localStorage.setItem(sendCapsCacheKey, JSON.stringify(types)); } catch { /* noop */ }
        try { localStorage.setItem(sendRefreshTsKey, String(Date.now())); } catch { /* noop */ }
      } catch {
        // best effort: keep cached values
      }
    };
    hydrateOnce();
    // Revalidate with throttle on app focus/visibility so quick route hops
    // do not trigger duplicate route-data fetches.
    const onFocus = () => { void hydrateOnce(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void hydrateOnce();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sendWalletsCacheKey, sendCapsCacheKey, externalAccountsCacheKey, sendRefreshTsKey]);

  // Select wallet when currency changes
  useEffect(() => {
    const w = wallets.find(w => w.currency === selectedCurrency);
    setSelectedWallet(w || null);
  }, [selectedCurrency, wallets]);

  useEffect(() => {
    if (method !== 'stablecoin') return;
    const tokenCurrency = String(crypto.token || 'USDC').toUpperCase();
    if (selectedCurrency !== tokenCurrency) setSelectedCurrency(tokenCurrency);
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
  }, [step, method, selectedCurrency, selectedAfricanCountryCode, selectedAfricanRail]);

  const loadInstitutions = async () => {
    if (institutionsLoadInFlightRef.current) {
      await institutionsLoadInFlightRef.current;
      return;
    }
    const run = (async () => {
    // Fast route re-entry: render cached institutions instantly when available.
    let seededFromCache = false;
    try {
      const raw = localStorage.getItem(institutionsCacheKey);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Array.isArray(cached) && cached.length > 0) {
          setInstitutions(cached);
          seededFromCache = true;
          setSelectedBank((prev) => prev || null);
        }
      }
    } catch { /* noop */ }
    if (!seededFromCache) setInstitutions([]);
    // Throttle duplicate rail fetches on quick step toggles.
    try {
      const last = Number(localStorage.getItem(institutionsRefreshTsKey) || '0');
      if (Number.isFinite(last) && Date.now() - last < 5 * 60_000) return;
    } catch { /* noop */ }

    if (!selectedAfricanCountryCode || (method !== 'bank' && method !== 'mobile_money')) {
      setInstitutions([]);
      setSelectedBank(null);
      setLoadingInstitutions(false);
      return;
    }

    setLoadingInstitutions(true);
    try {
      const res: any = selectedAfricanProvider === 'yellow_card'
        ? await backendAPI.payouts.yellowCardCapabilities('networks', { country: selectedAfricanCountryCode })
        : null;
      if (!res?.success) {
        throw new Error(res?.error || 'Unable to load available payout rails.');
      }
      const providerNetworks = res?.data?.networks;
      const rawList = Array.isArray(providerNetworks)
        ? providerNetworks
        : (Array.isArray(providerNetworks?.networks) ? providerNetworks.networks
          : (Array.isArray(providerNetworks?.data) ? providerNetworks.data : []));
      const list: Institution[] = (Array.isArray(rawList) ? rawList : [])
        .filter((row: any) => {
          const accountType = String(row?.accountNumberType || row?.account_type || '').toLowerCase();
          return !accountType || (method === 'mobile_money'
            ? ['phone', 'momo', 'mobile_money', 'mobilemoney'].includes(accountType)
            : accountType === 'bank');
        })
        .map((row: any, idx: number) => ({
          code: String(
            row?.id || row?.code || row?.network || row?.name || `rail_${idx}`
          ).trim(),
          name: String(row?.name || row?.bank_name || row?.network || row?.provider || row?.code || `Rail ${idx + 1}`).trim(),
          type: method,
        }))
        .filter((row) => row.code && row.name);
      setInstitutions(list);
      setSelectedBank((prev) => {
        if (!prev) return null;
        return list.some((row) => row.code === prev.code) ? prev : null;
      });
      try { localStorage.setItem(institutionsCacheKey, JSON.stringify(list)); } catch { /* noop */ }
      try { localStorage.setItem(institutionsRefreshTsKey, String(Date.now())); } catch { /* noop */ }
    } catch (error: any) {
      setInstitutions([]);
      setSelectedBank(null);
      toast.error(friendlyError(error?.message, 'Unable to load available payout rails.'));
    } finally {
      setLoadingInstitutions(false);
    }
    })();
    institutionsLoadInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (institutionsLoadInFlightRef.current === run) {
        institutionsLoadInFlightRef.current = null;
      }
    }
  };

  // Validate transfer limits whenever amount/currency/method changes
  useEffect(() => {
    const sourceAmount = parseFloat(amount);
    if (!sourceAmount || method === 'us_ach_wire' || method === 'stablecoin') {
      setLimitError(null);
      return;
    }
    // Provider limits are denominated in destination fiat. The source amount
    // here is a stablecoin value and must never be compared directly to KES.
    const amountToValidate = isAfricanPayout ? Number(africanQuote?.destinationAmount) : sourceAmount;
    if (!Number.isFinite(amountToValidate) || amountToValidate <= 0) {
      setLimitError(null);
      return;
    }
    const channel = method === 'mobile_money' ? 'mobile_money' : 'bank';
    const symbol = getCurrencySymbol(selectedCurrency);
    const err = validateTransferAmount(amountToValidate, selectedCurrency, channel, symbol);
    setLimitError(err);
  }, [amount, selectedCurrency, method, isAfricanPayout, africanQuote?.destinationAmount]);

  const stablecoinMinimumError = useMemo(() => {
    if (method !== 'stablecoin') return null;
    const num = parseFloat(amount);
    if (!Number.isFinite(num) || num <= 0) return null;
    if (num < UI_CRYPTO_MIN_GROSS_USD) return cryptoMinimumMessage(crypto);
    return null;
  }, [amount, method, crypto]);

  // Fee is computed synchronously by the engine (networkFee useMemo) — no async
  // fetch needed for the review step.

  // ---------------------------------------------------------------------------
  // Navigation helpers
  // ---------------------------------------------------------------------------
  const goBack = () => {
    switch (step) {
      case 'method': onBack(); break;
      case 'africa-destination': setStep('method'); break;
      case 'africa-rail': setStep('africa-destination'); break;
      case 'crypto-wallet': setStep('method'); break;
      case 'details': setStep(method === 'bank' || method === 'mobile_money' ? 'africa-rail' : 'method'); break;
      case 'amount': setStep('details'); break;
      case 'review': setStep('amount'); break;
      case 'security-gate': setStep('review'); break;
      case 'pin': setStep('review'); break;
      case 'error': setStep('review'); break;
      default: onBack();
    }
  };

  const canProceedDetails = () => {
    if (method === 'us_ach_wire') return !!selectedExternalAccount;
    if (method === 'stablecoin') return !!cryptoSavedRouteId && !!cryptoSavedWalletId && cryptoRouteDetailsReady && isValidCryptoAddress(crypto.network, crypto.address);
    if (method === 'bank' || method === 'mobile_money') {
      const formattedRecipientAccount = method === 'mobile_money'
        ? formatInternationalPhone(accountNumber, selectedAfricanCountryCode)
        : accountNumber.trim();
      return !!selectedAfricanCountryCode
        && !!selectedAfricanRail
        && selectedAfricanProvider === 'yellow_card'
        && (!requiresInstitutionSelection || !!selectedBank)
        && recipientName.trim().length >= 2
        && (method === 'mobile_money'
          ? isLikelyInternationalPhone(accountNumber, selectedAfricanCountryCode)
          : formattedRecipientAccount.length >= 6);
    }
    return false;
  };

  const canProceedAmount = () => {
    if (limitError || stablecoinMinimumError) return false;
    const num = parseFloat(amount);
    if (method === 'us_ach_wire') {
      return num > 0
        && !!activeExternalFundingWallet
        && num <= Number(activeExternalFundingWallet.balance || 0)
        && reason.trim().length > 0;
    }
    if (method === 'stablecoin') {
      return num > 0
        && !!cryptoSavedRouteId
        && !!cryptoSavedWalletId
        && cryptoRouteDetailsReady
        && isValidCryptoAddress(crypto.network, crypto.address)
        && reason.trim().length > 0;
    }
    if (isAfricanPayout) {
      return africanRailsTester && num > 0 && !!activeFundingWallet && !africanInsufficientFunding &&
        !africanQuoteLoading && !!africanQuote?.destinationAmount && !!africanPolicyFee;
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
        if (stablecoinMinimumError) {
          setErrorMessage(stablecoinMinimumError);
          setStep('error');
          toast.error(stablecoinMinimumError);
          return;
        }
        if (!selectedWallet?.bridge_wallet_id) {
          throw new Error('This wallet is not ready for sending yet. Please refresh and try again.');
        }
        if (!cryptoSavedRouteId || !cryptoSavedWalletId) {
          throw new Error('Choose a saved withdrawal wallet with an active BorderPay route before sending. Add the wallet again if this destination is missing its route.');
        }
        if (!cryptoRouteDetailsReady) {
          throw new Error('Refresh this saved withdrawal wallet before sending so the route fee and deposit instructions are current.');
        }
        result = await backendAPI.stablecoin.sendTransfer({
          amount: parseFloat(amount),
          reason: reason || 'Digital dollar transfer',
          address: crypto.address.trim(),
          chain: crypto.network,                                  // tron|base
          coin: crypto.token.toLowerCase() as 'usdc' | 'usdt',
          bridge_wallet_id: selectedWallet.bridge_wallet_id,
          external_wallet_id: cryptoSavedWalletId,
          bridge_payment_route_id: cryptoSavedRouteId,
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
        if (!activeExternalFundingWallet?.bridge_wallet_id) {
          throw new Error('Add USDC or USDT before sending to an external account.');
        }
        const destinationRail =
          selectedExternalAccount.account_type === 'iban' ? 'sepa'
          : selectedExternalAccount.account_type === 'gb' ? 'faster_payments'
          : 'ach';
        result = await backendAPI.bridge.transfer.create({
          idempotency_key: transferIdempotencyKey,
          source: {
            payment_rail: 'bridge_wallet',
            currency: activeExternalFundingCurrency,
            amount: String(parseFloat(amount)),
            bridge_wallet_id: activeExternalFundingWallet.bridge_wallet_id,
          },
          destination: {
            payment_rail: destinationRail,
            currency: selectedExternalAccount.currency,
            external_account_id: selectedExternalAccount.bridge_external_account_id,
          },
        });
      } else if (method === 'bank' || method === 'mobile_money') {
        if (!africanRailsTester) {
          throw new Error('African rail transfers are visible for planning but execution remains in controlled integration testing.');
        }
        if (!selectedAfricanCountryCode || !selectedAfricanRail) {
          throw new Error('Select a destination country and payout rail.');
        }
        if (!activeFundingWallet) {
          throw new Error('Add USDC or USDT before sending to Africa.');
        }
        if (selectedAfricanProvider !== 'yellow_card') {
          throw new Error('This payout corridor is not available yet.');
        }
        if (!africanQuote?.destinationAmount) {
          throw new Error('Quote this corridor before sending.');
        }
        const beneficiaryName = recipientName.trim() || resolvedName || undefined;
        if (!selectedBank?.code) throw new Error('Select the recipient bank or mobile money network.');
        const localAmount = Math.round(africanQuote.destinationAmount);
        const settlementNetwork = activeFundingCurrency === 'USDC' ? 'BASE' : 'TRC20';
        const request = {
          currency: selectedCurrency,
          country: selectedAfricanCountryCode,
          channel: method,
          local_amount: localAmount,
          settlement_currency: activeFundingCurrency,
          settlement_network: settlementNetwork,
          crypto_amount: parseFloat(amount),
          network_id: selectedBank.code,
          reason: 'other',
          recipient_name: beneficiaryName,
          sandbox_outcome: yellowCardSandboxOutcome,
        };
        const preflight: any = await backendAPI.payouts.yellowCardSandboxTransaction({
          action: 'preflight_send',
          ...request,
        });
        if (!preflight?.success || !preflight?.data?.can_create) {
          throw new Error(preflight?.error || preflight?.code || 'The send preflight is incomplete.');
        }
        result = await backendAPI.payouts.yellowCardSandboxTransaction({
          action: 'create_send',
          ...request,
          channel_id: preflight.data.selected_channel_id,
          sequence_id: globalThis.crypto.randomUUID(),
          operator_confirmed: true,
        });
      } else {
        throw new Error('Unsupported transfer method.');
      }

      if (result.success) {
        // The provider webhook owns the balance mutation. Drop every derived
        // financial cache now so Dashboard, Wallet, Activity and Notifications
        // cannot keep rendering the pre-payout snapshot after navigation.
        backendAPI.financial.invalidateForUser(userId);
        // bridge-transfer returns { transfer_id, state }; legacy paths return
        // { transaction_id, reference, new_balance }. Surface whichever exists.
        setTransactionId(
          result.data?.transaction?.provider_transaction_id
          || result.data?.transaction_id
          || result.data?.transfer_id
          || ''
        );
        setTransactionRef(
          result.data?.transaction?.sequence_id
          || result.data?.reference
          || result.data?.transfer_id
          || ''
        );
        setNewBalance(result.data?.new_balance ?? null);
        setStep('success');
        toast.success(t('send.txSuccessful'));
      } else {
        // Map structured server codes to friendly user-facing messages.
        const code = (result as any)?.code;
        const friendly =
          code === 'country_not_supported' ? (result.error || 'Your country is not yet supported. We are bringing it online soon.')
        : code === 'no_partner'           ? (result.error || 'This payout rail is coming soon through BorderPay.')
        : code === 'rails_future_state'   ? 'This transfer rail is launching soon. Use the digital dollar path for now.'
        : method === 'stablecoin'         ? mapCryptoTransferError(code, result.error, crypto)
        : code === 'kyc_not_approved'     ? 'Finish identity verification before sending funds.'
        : code === 'no_customer'          ? 'Finish account setup before sending funds.'
        : (result.error || t('send.txFailed'));

        setErrorMessage(friendly || t('send.txFailed'));
        setStep('error');
        if (friendly) toast.error(friendlyError(friendly, t('send.txFailed')));
      }
    } catch (error: any) {
      const fallback = friendlyError(error?.message, t('send.txFailed'));
      const friendly = method === 'stablecoin'
        ? mapCryptoTransferError(undefined, fallback, crypto)
        : fallback;
      setErrorMessage(friendly);
      setStep('error');
      toast.error(friendlyError(friendly, t('send.txFailed')));
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
      const verification = await PINManager.verifyTransactionPIN(userId, value);
      if (!verification.success) {
        toast.error(friendlyError(verification.error, t('send.incorrectPin') || 'Incorrect PIN'));
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
      case 'africa-destination': return 'Send to Africa';
      case 'africa-rail': return selectedAfricanCountry?.countryName || 'Send to Africa';
      case 'crypto-wallet': return 'Withdrawal Wallet';
      case 'details': return method === 'us_ach_wire' ? t('send.usPaymentDetails') : method === 'stablecoin' ? 'Digital Dollar Transfer' : t('send.borderPayDetails');
      case 'amount': return t('send.amount');
      case 'review': return t('send.reviewTransfer');
      case 'pin': return t('send.verifyTransaction');
      case 'processing': return t('send.processingTx');
      case 'success': return t('send.txSuccessful');
      case 'error': return t('send.txFailed');
      default: return t('send.title');
    }
  };

  const transferRecipientLabel = isAfricanPayout
    ? (recipientName || resolvedName || formatInternationalPhone(accountNumber, selectedAfricanCountryCode) || selectedAfricanCountry?.countryName || 'Africa recipient')
    : method === 'stablecoin'
      ? `${crypto.address.slice(0, 8)}...${crypto.address.slice(-6)}`
      : (selectedExternalAccount?.account_owner_name || 'External account');
  const sourceCurrencyDisplay = isAfricanPayout ? displayMoneyCurrency(amountCurrency) : amountCurrency;
  const formatSourceMoney = useCallback((value: number, options?: Intl.NumberFormatOptions) => (
    isAfricanPayout ? formatDisplayMoney(value, amountCurrency, options) : formatMoney(value, amountCurrency, options)
  ), [amountCurrency, isAfricanPayout]);
  const externalRecipientGetsLabel = selectedExternalAccount
    ? `${selectedExternalAccount.currency} account`
    : 'External account';

  const downloadReceiptPdf = () => {
    const recipientAccount = isAfricanPayout && method === 'mobile_money'
      ? formatInternationalPhone(accountNumber, selectedAfricanCountryCode)
      : accountNumber;
    const recipientGets = isAfricanPayout && africanQuote?.destinationAmount
      ? `${formatMoney(africanQuote.destinationAmount, selectedCurrency)} ${selectedCurrency}`
      : method === 'us_ach_wire'
        ? externalRecipientGetsLabel
        : method === 'stablecoin'
          ? `${formatMoney(networkFee?.netAmount ?? sourceAmount, amountCurrency)} ${amountCurrency}`
          : `${formatSourceMoney(sourceAmount)} ${sourceCurrencyDisplay}`;
    const transactionFee = isAfricanPayout && africanPolicyFee
      ? `${formatDisplayMoney(africanPolicyFee.amount, africanPolicyFee.currency)} ${displayMoneyCurrency(africanPolicyFee.currency)}`
      : networkFee
        ? (networkFee.totalFee === 0 ? 'Free' : `${formatSourceMoney(networkFee.totalFee)} ${sourceCurrencyDisplay}`)
        : 'Included in quote';
    const receiptLines = [
      { label: 'Money out receipt', value: `${formatSourceMoney(sourceAmount)} ${sourceCurrencyDisplay}`, large: true },
      { label: 'Status', value: 'Transaction sent' },
      { label: 'Recipient', value: recipientName || resolvedName || transferRecipientLabel },
      ...(recipientAccount ? [{ label: method === 'bank' ? 'Account number' : 'Recipient number', value: recipientAccount }] : []),
      ...(method === 'stablecoin' ? [{ label: 'Destination wallet', value: `${crypto.token} on ${chainDisplayName(crypto.network)} - ${shortAddress(crypto.address)}` }] : []),
      { label: 'Recipient gets', value: recipientGets },
      { label: 'Transaction fee', value: transactionFee },
      { label: 'Reference', value: transactionRef || transactionId || transferIdempotencyKey },
      { label: 'Date', value: new Date().toLocaleString() },
      { label: 'Note', value: 'This receipt confirms your BorderPay money out request. Final settlement status may depend on the receiving rail.' },
    ];
    const blob = buildReceiptPdf(receiptLines);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BorderPay-receipt-${transactionId || transactionRef || Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
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
            <div className="mb-4">
              <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>Send Money</p>
              <p className={`mt-1 text-sm ${tc.textSecondary}`}>Choose how you want to send</p>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  setStep('africa-destination');
                  void loadAfricanPolicy();
                }}
                className={`group flex w-full items-center gap-3 rounded-2xl border border-[#58D66D]/25 ${tc.card} p-4 text-left transition-colors hover:border-[#58D66D]/45 ${tc.hoverBg}`}
                aria-label="Send to Africa"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#58D66D]/25 bg-[#58D66D]/12">
                  <Smartphone className="h-5 w-5 text-[#58D66D]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-semibold ${tc.text}`}>Send to Africa</p>
                  <p className="mt-1 truncate text-xs font-semibold text-[#58D66D]">
                    Mobile money and local bank rails
                  </p>
                  <p className="mt-1 truncate text-xs text-white/40">
                    Choose a destination and available rail
                  </p>
                </div>
                <ArrowRight size={18} className={tc.textMuted} />
              </button>

              {TRANSFERS_LIVE ? (
                <button
                  type="button"
                  onClick={() => {
                    const tokenCurrency = String(crypto.token || 'USDC').toUpperCase();
                    setMethod('stablecoin');
                    setSelectedCurrency(tokenCurrency);
                    setStep('crypto-wallet');
                    void loadExternalWallets();
                  }}
                  className={`group flex w-full items-center gap-3 rounded-2xl border ${tc.cardBorder} ${tc.card} p-4 text-left transition-colors ${tc.hoverBg}`}
                  aria-label="External digital dollar"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/12">
                    <Coins className="h-5 w-5 text-cyan-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-semibold ${tc.text}`}>External digital dollar</p>
                    <p className="mt-1 truncate text-xs font-semibold text-cyan-400">USDC on Base or USDT on TRON</p>
                    <p className="mt-1 truncate text-xs text-white/40">Send to an external wallet address</p>
                  </div>
                  <ArrowRight size={18} className={tc.textMuted} />
                </button>
              ) : (
                <div
                  className={`flex w-full cursor-not-allowed items-center gap-3 rounded-2xl border ${tc.cardBorder} ${tc.card} p-4 text-left opacity-60`}
                  aria-disabled="true"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/12">
                    <Coins className="h-5 w-5 text-cyan-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-semibold ${tc.text}`}>External digital dollar</p>
                    <p className="mt-1 truncate text-xs font-semibold text-cyan-400">USDC on Base or USDT on TRON</p>
                    <p className="mt-1 truncate text-xs text-white/40">Pending sandbox evidence sign-off</p>
                  </div>
                  <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-amber-300">
                    Pending
                  </span>
                </div>
              )}

              {EXTERNAL_ACCOUNTS_LIVE ? (
                <button
                  type="button"
                  onClick={() => { setMethod('us_ach_wire'); setStep('details'); }}
                  className={`group flex w-full items-center gap-3 rounded-2xl border ${tc.cardBorder} ${tc.card} p-4 text-left transition-colors ${tc.hoverBg}`}
                  aria-label="External global bank account"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#C7FF00]/20 bg-[#C7FF00]/12">
                    <Building2 className="h-5 w-5 text-[#C7FF00]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-semibold ${tc.text}`}>External global bank account</p>
                    <p className="mt-1 truncate text-xs font-semibold text-[#C7FF00]">
                      {externalAccountTypes.includes('iban') || externalAccountTypes.includes('gb') ? 'ACH, SEPA and Faster Payments' : 'Bank payout route'}
                    </p>
                    <p className="mt-1 truncate text-xs text-white/40">
                      {externalAccountTypes.length === 0 ? 'Add an external account to send payouts' : 'Send to saved external bank details'}
                    </p>
                  </div>
                  <ArrowRight size={18} className={tc.textMuted} />
                </button>
              ) : (
                <div
                  className={`flex w-full cursor-not-allowed items-center gap-3 rounded-2xl border ${tc.cardBorder} ${tc.card} p-4 text-left opacity-60`}
                  aria-disabled="true"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#C7FF00]/20 bg-[#C7FF00]/12">
                    <Building2 className="h-5 w-5 text-[#C7FF00]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-semibold ${tc.text}`}>External global bank account</p>
                    <p className="mt-1 truncate text-xs font-semibold text-[#C7FF00]">Bank payout route</p>
                    <p className="mt-1 truncate text-xs text-white/40">Bank payouts are coming soon</p>
                  </div>
                  <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white/60">
                    Soon
                  </span>
                </div>
              )}
            </div>

            <div className={`mt-6 flex items-start gap-2 px-4 py-3 ${tc.card} rounded-xl border ${tc.borderLight}`}>
              <Info size={16} className="text-[#C7FF00] mt-0.5 flex-shrink-0" />
              <p className={`text-xs ${tc.textMuted}`}>
                African countries and payout rails are kept up to date automatically.
              </p>
            </div>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 1B: Choose African Destination                                */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'africa-destination' && (
          <motion.div
            key="africa-destination"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-5 py-6"
          >
            <div className="mb-4">
              <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>Send Money</p>
              <p className={`mt-1 text-sm ${tc.textSecondary}`}>
                {africanPolicyLoading
                  ? 'Loading available countries'
                  : africanRailCount > 0
                    ? `${africanCountries.length} countries · ${africanRailCount} rails`
                    : 'Choose a destination'}
              </p>
            </div>

            {africanPolicyLoading && (
              <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5 flex items-center gap-3`}>
                <Loader2 className="h-5 w-5 animate-spin text-[#C7FF00]" />
                <p className={`text-sm ${tc.textSecondary}`}>Loading African payout rails...</p>
              </div>
            )}

            {!africanPolicyLoading && africanPolicyError && (
              <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5`}>
                <p className={`text-sm font-semibold ${tc.text}`}>Could not load African rails</p>
                <p className={`mt-1 text-xs ${tc.textMuted}`}>{africanPolicyError}</p>
                <button
                  type="button"
                  onClick={() => loadAfricanPolicy(true)}
                  className="mt-4 inline-flex h-10 items-center rounded-xl bg-[#C7FF00] px-4 text-sm font-semibold text-black"
                >
                  Retry
                </button>
              </div>
            )}

            {!africanPolicyLoading && !africanPolicyError && (
              <div className="space-y-3">
                {africanCountries.map((country) => {
                  const options = getRailOptions(country);
                  return (
                    <button
                      key={country.countryCode}
                      type="button"
                      onClick={() => {
                        setSelectedAfricanCountryCode(country.countryCode);
                        setSelectedAfricanRail(null);
                        setSelectedBank(null);
                        setAccountNumber('');
                        setRecipientName('');
                        setResolvedName('');
                        setResolveError('');
                        setStep('africa-rail');
                      }}
                      className={`group flex w-full items-center gap-3 rounded-2xl border ${tc.cardBorder} ${tc.card} p-4 text-left transition-colors ${tc.hoverBg}`}
                      aria-label={`Send to ${country.countryName}`}
                    >
                      <CorridorFlag flag={country.flag} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className={`truncate text-sm font-semibold ${tc.text}`}>{country.countryName}</p>
                          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold text-white/55">
                            {country.countryCode}
                          </span>
                        </div>
                        <p className={`mt-1 truncate text-xs ${tc.textMuted}`}>
                          {options.map((option) => railLabel(option.channel)).join(' · ')}
                        </p>
                        <p className="mt-1 truncate text-xs text-white/40">{country.currencies.join(', ')}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-bold text-white/55">
                          {options.length} {options.length === 1 ? 'rail' : 'rails'}
                        </span>
                        <ArrowRight size={18} className={tc.textMuted} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-5 grid grid-cols-3 rounded-2xl border border-white/[0.08] bg-black/35 py-3">
              {[
                { icon: Shield, title: 'Secure', body: 'Verified routes' },
                { icon: Zap, title: 'Fast', body: 'Built for speed' },
                { icon: Users, title: 'Reliable', body: 'Clear status' },
              ].map((item, index) => (
                <div key={item.title} className={`px-3 text-center ${index > 0 ? 'border-l border-white/10' : ''}`}>
                  <item.icon className="mx-auto mb-1.5 h-5 w-5 text-[#58D66D]" />
                  <p className={`text-xs font-semibold ${tc.text}`}>{item.title}</p>
                  <p className="mt-0.5 text-[11px] leading-tight text-white/45">{item.body}</p>
                </div>
              ))}
            </div>

            <div className={`mt-6 flex items-start gap-2 px-4 py-3 ${tc.card} rounded-xl border ${tc.borderLight}`}>
              <Info size={16} className="text-[#C7FF00] mt-0.5 flex-shrink-0" />
              <p className={`text-xs ${tc.textMuted}`}>
                Available countries and rail options are kept up to date automatically.
              </p>
            </div>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 1C: Choose African Rail                                       */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'africa-rail' && selectedAfricanCountry && (
          <motion.div
            key="africa-rail"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-5 py-6"
          >
            <div className="mb-4">
              <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>Send Money</p>
              <div className="mt-2 flex items-center gap-3">
                <CorridorFlag flag={selectedAfricanCountry.flag} />
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${tc.text}`}>{selectedAfricanCountry.countryName}</p>
                  <p className={`text-xs ${tc.textMuted}`}>Choose an available payout rail</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {selectedAfricanRailOptions.map((option) => (
                <button
                  key={`${selectedAfricanCountry.countryCode}-${option.channel}`}
                  type="button"
                  onClick={() => {
                    setSelectedAfricanRail(option);
                    setMethod(option.channel);
                    setSelectedCurrency(option.currency);
                    setSelectedBank(null);
                    setAccountNumber('');
                    setRecipientName('');
                    setResolvedName('');
                    setResolveError('');
                    setShowBankList(false);
                    setStep('details');
                  }}
                  className={`group flex w-full items-center gap-3 rounded-2xl border ${tc.cardBorder} ${tc.card} p-4 text-left transition-colors ${tc.hoverBg}`}
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#C7FF00]/20 bg-[#C7FF00]/12">
                    <RouteIcon method={option.channel} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-semibold ${tc.text}`}>{railLabel(option.channel)}</p>
                    <p className={`mt-1 truncate text-xs ${tc.textMuted}`}>
                      {railDescription(option.channel, selectedAfricanCountry.countryName)}
                    </p>
                    <p className="mt-1 truncate text-xs text-white/40">
                      {option.rows.map((row) => row.currency).join(', ')}
                    </p>
                  </div>
                  <ArrowRight size={18} className={tc.textMuted} />
                </button>
              ))}
            </div>

            <div className={`mt-6 flex items-start gap-2 px-4 py-3 ${tc.card} rounded-xl border ${tc.borderLight}`}>
              <Info size={16} className="text-[#C7FF00] mt-0.5 flex-shrink-0" />
              <p className={`text-xs ${tc.textMuted}`}>
                BorderPay will route this transfer through the available rail for the selected country.
              </p>
            </div>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 1D: Choose Saved Crypto Withdrawal Wallet                     */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {step === 'crypto-wallet' && (
          <motion.div
            key="crypto-wallet"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-5 py-6"
          >
            <div className="mb-4">
              <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>Digital dollar payout</p>
              <p className={`mt-1 text-sm ${tc.textSecondary}`}>Choose a saved withdrawal wallet</p>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2">
              {[
                { token: 'USDC', network: 'base', label: 'USDC', sub: 'Base' },
                { token: 'USDT', network: 'tron', label: 'USDT', sub: 'TRON' },
              ].map((route) => {
                const active = crypto.token === route.token && crypto.network === route.network;
                return (
                  <button
                    key={`${route.token}-${route.network}`}
                    type="button"
                    onClick={() => {
                      const normalized = normalizeCryptoRoute(route.network, route.token);
                      setCrypto({ ...normalized, address: '' });
                      setSelectedCurrency(normalized.token);
                      setCryptoSavedRouteId('');
                      setCryptoSavedWalletId('');
                    }}
                    className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                      active
                        ? 'border-[#C7FF00]/70 bg-[#C7FF00]/10 shadow-[0_0_18px_rgba(199,255,0,0.12)]'
                        : `${tc.cardBorder} ${tc.card} ${tc.hoverBg}`
                    }`}
                  >
                    <span className={`block text-sm font-bold ${active ? 'text-[#C7FF00]' : tc.text}`}>{route.label}</span>
                    <span className={`mt-1 block text-[11px] ${tc.textMuted}`}>{route.sub}</span>
                  </button>
                );
              })}
            </div>

            <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl overflow-hidden`}>
              <div className={`flex items-center justify-between border-b ${tc.borderLight} px-4 py-3`}>
                <div>
                  <p className={`text-sm font-semibold ${tc.text}`}>{cryptoRouteLabel(crypto)}</p>
                  <p className={`text-xs ${tc.textMuted}`}>Saved destinations only</p>
                </div>
                <button
                  type="button"
                  onClick={() => loadExternalWallets()}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tc.hoverBg} ${tc.textSecondary}`}
                >
                  Refresh
                </button>
              </div>

              {externalWalletsLoading ? (
                <div className="flex items-center gap-3 px-4 py-5">
                  <Loader2 className="h-5 w-5 animate-spin text-[#C7FF00]" />
                  <p className={`text-sm ${tc.textSecondary}`}>Loading withdrawal wallets...</p>
                </div>
              ) : externalWalletsError ? (
                <div className="px-4 py-5">
                  <p className="text-sm font-semibold text-red-400">Could not load saved wallets</p>
                  <p className={`mt-1 text-xs ${tc.textMuted}`}>{externalWalletsError}</p>
                </div>
              ) : filteredExternalWallets.length > 0 ? (
                <div className="divide-y divide-white/[0.06]">
                  {filteredExternalWallets.map((wallet) => (
                    <button
                      key={wallet.id}
                      type="button"
                      onClick={() => selectExternalWallet(wallet)}
                      className={`flex w-full items-center gap-3 px-4 py-4 text-left transition-colors ${tc.hoverBg}`}
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/12">
                        <Coins className="h-5 w-5 text-cyan-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-semibold ${tc.text}`}>{wallet.label || `${wallet.asset} wallet`}</p>
                        <p className={`mt-1 truncate text-xs ${tc.textMuted}`}>
                          {wallet.asset} on {chainDisplayName(wallet.chain)} · {shortAddress(wallet.address)}
                        </p>
                        <p className={`mt-1 truncate text-[11px] ${wallet.bridge_payment_route_id ? 'text-[#C7FF00]' : 'text-amber-300'}`}>
                          {wallet.bridge_payment_route_id ? 'BorderPay route active' : 'Saved wallet'}
                        </p>
                      </div>
                      <ArrowRight size={18} className={tc.textMuted} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6 text-center">
                  <Coins className={`mx-auto mb-3 h-7 w-7 ${tc.textMuted}`} />
                  <p className={`text-sm font-semibold ${tc.text}`}>No saved wallet for {cryptoRouteLabel(crypto)}</p>
                  <p className={`mt-1 text-xs ${tc.textMuted}`}>
                    Add your external wallet once. BorderPay registers the route before money can move.
                  </p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => onNavigate?.('external-wallets')}
              className="mt-4 w-full rounded-full bg-[#C7FF00] px-4 py-4 text-sm font-bold text-black transition-all active:scale-[0.98]"
            >
              Add withdrawal wallet
            </button>
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
              const availableCurrencies = SUPPORTED_CURRENCIES.filter(c => c.code === selectedCurrency);
              return (
              <div className="mb-5">
                <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>Destination</label>
                {selectedAfricanRail && selectedAfricanCountry ? (
                  <div className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl px-4 py-3.5 flex items-center gap-3`}>
                    <span className="text-xl">{selectedAfricanCountry.flag}</span>
                    <div>
                      <p className={`text-sm font-semibold ${tc.text}`}>{selectedAfricanCountry.countryName}</p>
                      <p className={`text-xs ${tc.textMuted}`}>{railLabel(selectedAfricanRail.channel)} · {selectedCurrency}</p>
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
                            setRecipientName('');
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
                    {selectedAfricanRail ? 'Rail' : method === 'bank' ? t('send.selectBank') : t('send.selectProvider')}
                  </label>

                  {selectedAfricanRail && !requiresInstitutionSelection ? (
                    <div className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl px-4 py-3.5 flex items-center justify-between`}>
                      <span className={`text-sm font-semibold ${tc.text}`}>
                        {railLabel(selectedAfricanRail.channel)}
                      </span>
                      <CheckCircle size={16} className="text-[#C7FF00]" />
                    </div>
                  ) : (
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
                  )}

                  {(!selectedAfricanRail || requiresInstitutionSelection) && showBankList && (
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
                            </button>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Recipient identity */}
                <div className="mb-4">
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>
                    Recipient full name
                  </label>
                  <input
                    type="text"
                    value={recipientName}
                    onChange={e => setRecipientName(e.target.value)}
                    placeholder="e.g. Adhiambo Otieno"
                    className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                  />
                </div>

                {/* Account Number */}
                <div className="mb-4">
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>
                    {method === 'bank' ? 'Recipient bank account number' : 'Recipient mobile money number'}
                  </label>
                  <input
                    type="text"
                    inputMode={method === 'mobile_money' ? 'tel' : 'numeric'}
                    value={accountNumber}
                    onChange={e => {
                      const next = method === 'mobile_money'
                        ? e.target.value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '')
                        : e.target.value.replace(/\D/g, '');
                      setAccountNumber(next);
                    }}
                    onBlur={() => {
                      if (method === 'mobile_money') {
                        setAccountNumber(formatInternationalPhone(accountNumber, selectedAfricanCountryCode));
                      }
                    }}
                    placeholder={method === 'bank' ? '0123456789' : `+${COUNTRY_DIAL_CODES[selectedAfricanCountryCode] || '254'}7xxxxxxxx`}
                    className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                  />
                  {method === 'mobile_money' && selectedAfricanCountry && (
                    <p className={`mt-1.5 px-1 text-[11px] ${tc.textMuted}`}>
                      Use the {selectedAfricanCountry.countryName} country code. Example: +{COUNTRY_DIAL_CODES[selectedAfricanCountryCode] || '254'}7xxxxxxxx
                    </p>
                  )}
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
                {/* External crypto withdrawal — saved wallet only */}
                <div className="mb-5">
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>Withdrawal wallet</label>
                  <button
                    type="button"
                    onClick={() => setStep('crypto-wallet')}
                    className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left ${tc.hoverBg} transition-colors`}
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/12">
                      <Coins className="h-5 w-5 text-cyan-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-semibold ${tc.text}`}>
                        {cryptoSavedWalletId ? cryptoRouteLabel(crypto) : 'Choose a saved wallet'}
                      </p>
                      <p className={`mt-1 truncate text-xs ${tc.textMuted}`}>
                        {cryptoSavedWalletId ? shortAddress(crypto.address) : 'USDC/Base or USDT/TRON'}
                      </p>
                    </div>
                    <ArrowRight size={18} className={tc.textMuted} />
                  </button>
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

            {/* Fiat external account payout details */}
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
                <div>
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>Funding wallet</label>
                  <div className="grid grid-cols-2 gap-2">
                    {BRIDGE_WALLET_FUNDING_CURRENCY_PRIORITY.map((currency) => {
                      const wallet = externalFundingWallets.find((item) => item.currency === currency);
                      const selected = activeExternalFundingWallet?.currency === currency;
                      return (
                        <button
                          key={currency}
                          type="button"
                          disabled={!wallet}
                          onClick={() => wallet && setSelectedExternalFundingCurrency(currency)}
                          className={`rounded-2xl border px-3 py-3 text-left transition-all ${
                            selected
                              ? 'border-[#C7FF00]/70 bg-[#C7FF00]/10 shadow-[0_0_18px_rgba(199,255,0,0.12)]'
                              : `${tc.borderLight} ${tc.inputBg}`
                          } disabled:cursor-not-allowed disabled:opacity-35`}
                        >
                          <span className={`block text-sm font-bold ${selected ? 'text-[#C7FF00]' : tc.text}`}>{currency}</span>
                          <span className={`mt-1 block text-[11px] ${tc.textMuted}`}>
                            {wallet ? `${formatMoney(Number(wallet.balance || 0), currency)} balance` : 'Wallet unavailable'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {!activeExternalFundingWallet && (
                    <p className="mt-2 px-1 text-xs text-red-400">Add USDC or USDT before sending to an external account.</p>
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
                  <p className={`text-sm font-semibold ${tc.text}`}>{recipientName || resolvedName || accountNumber}</p>
                  <p className={`text-xs ${tc.textMuted}`}>
                    {railLabel(method)} • {method === 'mobile_money' ? formatInternationalPhone(accountNumber, selectedAfricanCountryCode) : accountNumber}
                  </p>
                </>
              )}
            </div>

            {/* Amount input */}
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className={`text-xs font-medium ${tc.textSecondary} block`}>
                  {isAfricanPayout || isExternalAccountOfframp ? 'You send' : t('send.amount')}
                </label>
                {isAfricanPayout && activeFundingWallet && (
                  <span className="shrink-0 rounded-full bg-[#C7FF00]/12 px-3 py-1 text-[11px] font-bold text-[#C7FF00] shadow-[0_0_18px_rgba(199,255,0,0.18)]">
                    {activeFundingWallet.sandbox ? 'Sandbox test balance' : `${formatMoney(Number(activeFundingWallet.balance || 0), 'USD')} available`}
                  </span>
                )}
                {isExternalAccountOfframp && activeExternalFundingWallet && (
                  <span className="shrink-0 rounded-full bg-[#C7FF00]/12 px-3 py-1 text-[11px] font-bold text-[#C7FF00] shadow-[0_0_18px_rgba(199,255,0,0.18)]">
                    {formatMoney(Number(activeExternalFundingWallet.balance || 0), activeExternalFundingCurrency)} available
                  </span>
                )}
              </div>
              <div className="relative">
                <span className={`absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold ${tc.text}`}>
                  {getCurrencySymbol(amountCurrency)}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl pl-14 pr-28 py-5 text-2xl font-bold focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                  placeholder="0.00"
                />
                {(isAfricanPayout && activeFundingWallet) || (isExternalAccountOfframp && activeExternalFundingWallet) ? (
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-xs font-bold text-white">
                    {isExternalAccountOfframp ? activeExternalFundingCurrency : activeFundingWallet?.currency}
                  </span>
                ) : null}
              </div>
              {isAfricanPayout && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {AFRICAN_FUNDING_CURRENCY_PRIORITY.map((currency) => {
                      const wallet = africanFundingWallets.find((item) => item.currency === currency);
                      const selected = activeFundingWallet?.currency === currency;
                      return (
                        <button
                          key={currency}
                          type="button"
                          disabled={!wallet}
                          onClick={() => wallet && setSelectedAfricanFundingCurrency(currency)}
                          className={`rounded-2xl border px-3 py-3 text-left transition-all ${
                            selected
                              ? 'border-[#C7FF00]/70 bg-[#C7FF00]/10 shadow-[0_0_18px_rgba(199,255,0,0.12)]'
                              : `${tc.borderLight} ${tc.inputBg}`
                          } disabled:cursor-not-allowed disabled:opacity-35`}
                        >
                          <span className={`block text-sm font-bold ${selected ? 'text-[#C7FF00]' : tc.text}`}>{currency}</span>
                          <span className={`mt-1 block text-[11px] ${tc.textMuted}`}>
                            {wallet ? (wallet.sandbox ? 'Sandbox test funds' : `${formatMoney(Number(wallet.balance || 0), 'USD')} balance`) : 'Wallet unavailable'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {africanQuoteLoading && (
                    <p className={`px-1 text-xs ${tc.textMuted}`}>Quoting recipient amount...</p>
                  )}
                  {africanQuote?.destinationAmount && (
                    <p className="px-1 text-xs text-[#C7FF00]">
                      Recipient gets about {formatMoney(africanQuote.destinationAmount, selectedCurrency)} {selectedCurrency}
                    </p>
                  )}
                  {africanComputedRate && (
                    <p className={`px-1 text-xs ${tc.textMuted}`}>
                      Rate: 1 {displayMoneyCurrency(activeFundingCurrency)} = {formatMoney(africanComputedRate, selectedCurrency, { maximumFractionDigits: 4 })} {selectedCurrency}
                    </p>
                  )}
                  {africanPolicyFee && sourceAmount > 0 && (
                    <p className={`px-1 text-xs ${tc.textMuted}`}>
                      Fee: {formatDisplayMoney(africanPolicyFee.amount, africanPolicyFee.currency)} {displayMoneyCurrency(africanPolicyFee.currency)}
                      {africanPolicyFee.percent !== null && africanPolicyFee.percent > 0 ? ` (${africanPolicyFee.percent.toFixed(africanPolicyFee.percent < 1 ? 2 : 3)}%)` : ''}
                    </p>
                  )}
                  {africanQuote?.destinationAmount && !africanPolicyFee && (
                    <p className="px-1 text-xs text-red-400">No commercial-document price applies to this amount.</p>
                  )}
                </div>
              )}
              {isExternalAccountOfframp && activeExternalFundingWallet && (
                <div className="flex items-center justify-between mt-2 px-1">
                  <p className={`text-xs ${tc.textMuted}`}>
                    {t('send.available')}: {formatMoney(Number(activeExternalFundingWallet.balance || 0), activeExternalFundingCurrency)} {activeExternalFundingCurrency}
                  </p>
                  <button
                    onClick={() => setAmount(String(activeExternalFundingWallet.balance || 0))}
                    className="text-xs text-[#C7FF00] font-semibold"
                  >
                    {t('send.sendMax')}
                  </button>
                </div>
              )}
              {!isAfricanPayout && !isExternalAccountOfframp && selectedWallet && (
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
              {isAfricanPayout && !activeFundingWallet && (
                <p className="text-xs text-red-400 mt-2 px-1">No funding wallet found. Add USDC or USDT first.</p>
              )}
              {isAfricanPayout && activeFundingWallet && africanQuoteError && !limitError && (
                <p className="text-xs text-red-400 mt-2 px-1 flex items-center gap-1">
                  <AlertCircle size={12} className="flex-shrink-0" />
                  {africanQuoteError}
                </p>
              )}
              {isAfricanPayout && africanInsufficientFunding && (
                <p className="text-xs text-red-400 mt-2 px-1 flex items-center gap-1">
                  <AlertCircle size={12} className="flex-shrink-0" />
                  Insufficient {activeFundingCurrency} balance for this amount and fee.
                </p>
              )}
              {isExternalAccountOfframp && !activeExternalFundingWallet && (
                <p className="text-xs text-red-400 mt-2 px-1">No USDC or USDT wallet found.</p>
              )}
              {!isAfricanPayout && !isExternalAccountOfframp && !selectedWallet && (
                <p className="text-xs text-red-400 mt-2 px-1">{t('send.noWalletForCurrency')}</p>
              )}
              {limitError && (
                <p className="text-xs text-red-400 mt-2 px-1 flex items-center gap-1">
                  <AlertCircle size={12} className="flex-shrink-0" />
                  {limitError}
                </p>
              )}
              {stablecoinMinimumError && (
                <p className="text-xs text-red-400 mt-2 px-1 flex items-center gap-1">
                  <AlertCircle size={12} className="flex-shrink-0" />
                  {stablecoinMinimumError}
                </p>
              )}
              {cryptoRouteDetailsError && (
                <p className="text-xs text-red-400 mt-2 px-1 flex items-center gap-1">
                  {externalWalletsLoading ? <Loader2 size={12} className="flex-shrink-0 animate-spin" /> : <AlertCircle size={12} className="flex-shrink-0" />}
                  {cryptoRouteDetailsError}
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
              {isAfricanPayout ? (
                <div className="mb-5 space-y-3">
                  <div className={`rounded-2xl border ${tc.borderLight} ${tc.inputBg} p-4`}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className={`text-xs ${tc.textMuted}`}>You send</p>
                      <span className="rounded-full border border-white/10 bg-black/35 px-3 py-1 text-xs font-bold text-white">
                        {displayMoneyCurrency(activeFundingCurrency)}
                      </span>
                    </div>
                    <p className={`text-3xl font-bold ${tc.text}`}>
                      {formatDisplayMoney(sourceAmount, activeFundingCurrency)}
                    </p>
                  </div>
                  <div className={`rounded-2xl border ${tc.borderLight} ${tc.inputBg} p-4`}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className={`text-xs ${tc.textMuted}`}>Recipient gets</p>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-xs font-bold text-white">
                        {selectedAfricanCountry?.flag || ''} {selectedCurrency}
                      </span>
                    </div>
                    <p className="text-3xl font-bold text-[#C7FF00]">
                      {formatMoney(africanQuote?.destinationAmount || 0, selectedCurrency)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center mb-5">
                  <p className={`text-xs ${tc.textMuted} mb-1`}>{t('send.youAreSending')}</p>
                  <p className="text-3xl font-bold text-[#C7FF00]">
                    {formatSourceMoney(sourceAmount)}
                  </p>
                  <p className={`text-xs ${tc.textMuted} mt-1`}>{sourceCurrencyDisplay}</p>
                </div>
              )}

              <div className={`h-px ${tc.border} mb-4`} />

              {/* Details */}
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className={`text-xs ${tc.textMuted}`}>{t('send.method')}</span>
                  <span className={`text-sm font-medium ${tc.text}`}>
                    {method === 'us_ach_wire' ? t('send.usAchWire') : method === 'stablecoin' ? 'Digital dollar' : railLabel(method)}
                  </span>
                </div>

                {method !== 'us_ach_wire' && method !== 'stablecoin' && (
                  <>
                    {selectedAfricanCountry && (
                      <div className="flex justify-between">
                        <span className={`text-xs ${tc.textMuted}`}>Destination</span>
                        <span className={`text-sm font-medium ${tc.text}`}>{selectedAfricanCountry.countryName}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>{method === 'bank' ? 'Bank' : 'Mobile money'}</span>
                      <span className={`text-sm font-medium ${tc.text}`}>{selectedBank?.name || policyRouteName(method)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className={`text-xs ${tc.textMuted}`}>Recipient name</span>
                      <span className={`text-sm font-medium ${tc.text} text-right`}>{recipientName || resolvedName || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-xs ${tc.textMuted}`}>{method === 'bank' ? 'Account number' : 'Recipient number'}</span>
                      <span className={`text-sm font-mono ${tc.text}`}>
                        {method === 'mobile_money' ? formatInternationalPhone(accountNumber, selectedAfricanCountryCode) : accountNumber}
                      </span>
                    </div>
                    {resolvedName && (
                      <div className="flex justify-between">
                        <span className={`text-xs ${tc.textMuted}`}>{t('send.accountName')}</span>
                        <span className={`text-sm font-medium ${tc.text}`}>{resolvedName}</span>
                      </div>
                    )}
                    {activeFundingWallet && (
                      <div className="flex justify-between">
                        <span className={`text-xs ${tc.textMuted}`}>Funding Source</span>
                        <span className={`text-sm font-medium ${tc.text}`}>
                          {activeFundingWallet.sandbox ? `${activeFundingWallet.currency} sandbox test funds` : `${activeFundingWallet.currency} Wallet`}
                        </span>
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
                    {activeExternalFundingWallet && (
                      <div className="flex justify-between">
                        <span className={`text-xs ${tc.textMuted}`}>Funding Source</span>
                        <span className={`text-sm font-medium ${tc.text}`}>{activeExternalFundingWallet.currency} Wallet</span>
                      </div>
                    )}
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
                  <span className={`text-xs ${tc.textMuted}`}>{isAfricanPayout ? 'Destination currency' : t('send.currency')}</span>
                  <span className={`text-sm font-medium ${tc.text}`}>
                    {isAfricanPayout ? selectedCurrency : isExternalAccountOfframp ? selectedExternalAccount?.currency || 'Fiat' : amountCurrency}
                  </span>
                </div>
              </div>
            </div>

            {/* BorderPay Network Fee — unified, fully-disclosed total.
                Provider stays invisible; the user sees exactly what they pay. */}
            {(networkFee || africanPolicyFee || isAfricanPayout) && (
              <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 mb-4`}>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className={tc.textMuted}>{isAfricanPayout ? 'You send' : 'Amount'}</span>
                    <span className={tc.text}>{formatSourceMoney(sourceAmount)} {sourceCurrencyDisplay}</span>
                  </div>
                  {isAfricanPayout && africanComputedRate && (
                    <div className="flex justify-between gap-4 text-xs">
                      <span className={tc.textMuted}>Exchange rate</span>
                      <span className={`${tc.text} text-right`}>
                        1 {displayMoneyCurrency(activeFundingCurrency)} = {formatMoney(africanComputedRate, selectedCurrency, { maximumFractionDigits: 4 })} {selectedCurrency}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className={tc.textMuted}>
                      Transaction fee{networkFee?.feePercent && networkFee.feePercent > 0 ? ` (${networkFee.feePercent.toFixed(networkFee.feePercent < 1 ? 2 : 3)}%)` : africanPolicyFee?.percent ? ` (${africanPolicyFee.percent.toFixed(africanPolicyFee.percent < 1 ? 2 : 3)}%)` : ''}
                      {africanQuoteLoading ? ' · updating...' : ''}
                    </span>
                    <span className={(networkFee?.totalFee ?? africanPolicyFee?.amount ?? 0) === 0 ? 'text-[#C7FF00]' : tc.text}>
                      {networkFee
                        ? (networkFee.totalFee === 0
                        ? 'Free'
                        : `${formatSourceMoney(networkFee.totalFee)} ${sourceCurrencyDisplay}`)
                        : africanPolicyFee
                          ? `${formatDisplayMoney(africanPolicyFee.amount, africanPolicyFee.currency)} ${displayMoneyCurrency(africanPolicyFee.currency)}`
                          : isAfricanPayout ? 'Included in quote' : 'Policy based'}
                    </span>
                  </div>
                  {(networkFee || isAfricanPayout) && (
                    <>
                      <div className={`h-px ${tc.border} my-1`} />
                      <div className="flex justify-between text-sm font-bold">
                        <span className={tc.text}>Total you pay</span>
                        <span className="text-[#C7FF00]">
                          {isAfricanPayout
                            ? `${formatDisplayMoney(africanTotalSourceDebit, amountCurrency)} ${displayMoneyCurrency(amountCurrency)}`
                            : method === 'stablecoin'
                              ? `${formatSourceMoney(sourceAmount)} ${sourceCurrencyDisplay}`
                              : `${formatSourceMoney(sourceAmount + (networkFee?.totalFee || 0))} ${sourceCurrencyDisplay}`}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-[11px]">
                    <span className={tc.textMuted}>Recipient gets</span>
                    <span className={tc.textMuted}>
                      {isAfricanPayout && africanQuote?.destinationAmount
                        ? `${formatMoney(africanQuote.destinationAmount, selectedCurrency)} ${selectedCurrency}`
                        : method === 'us_ach_wire'
                          ? externalRecipientGetsLabel
                          : method === 'stablecoin'
                            ? `${formatMoney(networkFee?.netAmount ?? sourceAmount, amountCurrency)} ${amountCurrency}`
                          : `${formatMoney(sourceAmount, amountCurrency)} ${amountCurrency}`}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {isAfricanPayout && selectedAfricanProvider === 'yellow_card' && africanRailsTester && (
              <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 mb-4`}>
                <p className={`text-xs font-semibold ${tc.text} mb-3`}>Sandbox outcome</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['success', 'failure'] as const).map((outcome) => (
                    <button
                      key={outcome}
                      type="button"
                      onClick={() => setYellowCardSandboxOutcome(outcome)}
                      className={`rounded-xl border px-3 py-2 text-xs font-bold capitalize transition-colors ${
                        yellowCardSandboxOutcome === outcome
                          ? 'border-[#C7FF00] bg-[#C7FF00]/10 text-[#C7FF00]'
                          : `${tc.borderLight} ${tc.textMuted}`
                      }`}
                    >
                      {outcome}
                    </button>
                  ))}
                </div>
                <p className={`mt-2 text-[11px] ${tc.textMuted}`}>Integration-review tester only. No real recipient funds move.</p>
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
                  setStep('security-gate');
                  return;
                }
                setStep('pin');
              }}
              className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98]"
            >
              {isAfricanPayout ? 'Confirm your transaction' : t('send.confirmAndPay')}
            </button>
          </motion.div>
        )}

        {step === 'security-gate' && (
          <TransactionSecurityGate
            onBack={() => setStep('review')}
            onSetupPin={() => onNavigate?.('pin-setup')}
            onSetupBiometric={() => onNavigate?.('biometric-setup')}
          />
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
                {formatSourceMoney(parseFloat(amount))} {sourceCurrencyDisplay} → {transferRecipientLabel}
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
              {formatSourceMoney(parseFloat(amount))}
            </p>
            <p className={`text-sm ${tc.textMuted} mb-6`}>
              → {transferRecipientLabel}
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
                    {formatSourceMoney(newBalance)}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <button
                onClick={() => {
                  setAmount('');
                  setReason('');
                  setPin('');
                  setTransactionId('');
                  setTransactionRef('');
                  setNewBalance(null);
                  setStep(isAfricanPayout ? 'africa-destination' : 'method');
                }}
                className="w-full bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98]"
              >
                Send again
              </button>
              <button
                onClick={downloadReceiptPdf}
                className={`w-full ${tc.card} border ${tc.borderLight} py-4 rounded-full font-bold ${tc.text} ${tc.hoverBg} transition-all active:scale-[0.98]`}
              >
                Download receipt
              </button>
              <button
                onClick={onComplete}
                className={`w-full py-3 rounded-full text-sm font-semibold ${tc.textMuted} ${tc.hoverBg}`}
              >
                {t('common.done')}
              </button>
            </div>
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
