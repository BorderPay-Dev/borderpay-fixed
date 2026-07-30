/**
 * ReceiveMoneyScreen — single unified list of "places someone can pay you" that
 * reuses the SAME premium row + sheet UI as the Wallet tab. Tapping a row opens
 * either:
 *   • AccountDetailSheet — the "bank letter" for USD / EUR / GBP virtual accounts
 *   • WalletDetailSheet  — the digital dollar deposit address sheet
 *
 * No more BridgeVirtualAccountsCard / BridgeWalletsCard (those broke + their UI
 * had drifted from the Wallet tab). One source, one component, one design.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Shield, Inbox, ChevronRight, Loader2, RefreshCw, Smartphone, Building2, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { authAPI } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';
import { deriveKycStatus } from '../../utils/config/environment';
import type { BridgeVirtualAccountCurrency } from '../../utils/compliance/partnerCountryPolicy';
import { FloatingBackButton } from '../common/FloatingBackButton';
import {
  AssetBadge, AccountDetailSheet, WalletDetailSheet, chainLabel,
} from '../dashboard/bridge/WalletVisuals';
import { financialCacheKey } from '../../utils/financial/cacheScope';
import { navPerfTrackCache } from '../../utils/performance/navigationPerf';
import { friendlyError } from '../../utils/errors/friendlyError';
import { canUseAfricanRails } from '../../utils/africanRailsAccess';
import {
  loadAfricanPolicyRows,
  readCachedAfricanPolicyRows,
  type AfricanPolicyRow,
  type AfricanRailChannel,
} from '../../utils/africanRailsPolicyCache';

interface ReceiveMoneyScreenProps {
  onBack: () => void;
  /** Kept for caller compatibility; the new screen always shows everything. */
  preSelectedWalletId?: string;
}

interface StableRow { id: string; currency: string; chain: string; address: string; status: string }
interface VaRow     { id: string; currency: BridgeVirtualAccountCurrency; rail: string | null; status: string; account_details: any; bridge_virtual_account_id: string }
type ReceiveStep = 'method' | 'africa-destination' | 'africa-rail' | 'africa-details' | 'africa-review' | 'africa-success';
interface AfricanCountryOption {
  countryCode: string;
  countryName: string;
  flag: string;
  currencies: string[];
  rows: AfricanPolicyRow[];
}

const RAIL_NAME: Record<string, string> = { USD: 'ACH / Wire', EUR: 'SEPA', GBP: 'Faster Payments' };
const AFRICAN_POLICY_REQUEST_TIMEOUT_MS = 6500;

function flagFromCountryCode(countryCode: string) {
  const code = String(countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '🌍';
  return code.split('').map((char) => String.fromCodePoint(127397 + char.charCodeAt(0))).join('');
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
  rows.forEach((row) => grouped.set(row.countryCode, [...(grouped.get(row.countryCode) || []), row]));
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
  country.rows.forEach((row) => grouped.set(row.channel, [...(grouped.get(row.channel) || []), row]));
  return [...grouped.entries()].map(([channel, rows]) => {
    const sorted = [...rows].sort((a, b) => b.priority - a.priority || a.currency.localeCompare(b.currency));
    const preferred = sorted.find((row) => row.currency !== 'USD') || sorted[0];
    return { channel, rows, currency: preferred.currency };
  });
}

function railLabel(channel: AfricanRailChannel) {
  return channel === 'bank' ? 'Local bank' : 'Mobile money';
}

function numberFromRaw(row: AfricanPolicyRow | null | undefined, key: string) {
  const n = Number(row?.raw?.[key]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const COUNTRY_DIAL_CODES: Record<string, string> = {
  BJ: '229', BW: '267', BF: '226', CM: '237', CI: '225', CD: '243',
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

function getCurrencySymbol(code: string) {
  const symbols: Record<string, string> = {
    NGN: '₦', KES: 'KSh', GHS: '₵', UGX: 'USh', TZS: 'TSh',
    XAF: 'FCFA', XOF: 'FCFA', SLE: 'Le', MZN: 'MT', MWK: 'MK', USD: '$',
  };
  return symbols[String(code || '').toUpperCase()] || String(code || '').toUpperCase();
}

function formatMoney(amount: number, currency: string, options?: Intl.NumberFormatOptions) {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${getCurrencySymbol(currency)}${safe.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  })}`;
}

function providerFromPolicy(row: AfricanPolicyRow | null | undefined) {
  return String(row?.provider || row?.raw?.provider || '').trim().toLowerCase();
}

function RailIcon({ channel }: { channel: AfricanRailChannel }) {
  return channel === 'bank'
    ? <Building2 className="w-5 h-5 text-[#C7FF00]" />
    : <Smartphone className="w-5 h-5 text-[#C7FF00]" />;
}

function readCachedProfile(): any {
  try {
    return JSON.parse(localStorage.getItem('borderpay_user') || '{}');
  } catch {
    return {};
  }
}

function normalizedCountry(value: unknown): string | null {
  const country = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

function readCachedVerified(): boolean {
  return deriveKycStatus(readCachedProfile()) === 'verified';
}

function readCachedCountry(): string | null {
  const u = readCachedProfile();
  return normalizedCountry(u?.country);
}

export function ReceiveMoneyScreen({ onBack }: ReceiveMoneyScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const snapshotReader = backendAPI.financial.getSnapshot;
  void snapshotReader;
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const storedUser = authAPI.getStoredUser() || {};
  const userId = (storedUser.id as string) || '';
  const africanRailsTester = canUseAfricanRails({
    id: userId || (storedUser as any)?.id,
    email: (storedUser as any)?.email,
  });
  const [isVerified, setIsVerified] = useState<boolean>(() => readCachedVerified());
  const [country, setCountry] = useState<string | null>(() => readCachedCountry());

  const stableWalletsCacheKey = useMemo(
    () => financialCacheKey('borderpay_wallets_v1', { userId }),
    [userId],
  );
  const vaCacheKey = useMemo(
    () => financialCacheKey('borderpay_va_v1', { userId }),
    [userId],
  );
  const receiveRefreshTsKey = useMemo(
    () => financialCacheKey('borderpay_receive_refresh_ts_v1', { userId }),
    [userId],
  );
  useEffect(() => {
    const stableHit = (() => {
      try {
        const scoped = JSON.parse(localStorage.getItem(stableWalletsCacheKey) || '[]');
        return Array.isArray(scoped) && scoped.length > 0;
      } catch { return false; }
    })();
    const vaHit = (() => {
      try {
        const scoped = JSON.parse(localStorage.getItem(vaCacheKey) || '[]');
        return Array.isArray(scoped) && scoped.length > 0;
      } catch { return false; }
    })();
    navPerfTrackCache('receive-money', stableHit || vaHit);
  }, [stableWalletsCacheKey, vaCacheKey]);

  // ── Data (seeded from cache so the screen mounts instantly) ──────────────
  const [stables, setStables] = useState<StableRow[]>(() => {
    try {
      const scoped = JSON.parse(localStorage.getItem(stableWalletsCacheKey) || '[]');
      return Array.isArray(scoped) ? scoped : [];
    } catch { return []; }
  });
  const [vas, setVas] = useState<VaRow[]>(() => {
    try {
      const scoped = JSON.parse(localStorage.getItem(vaCacheKey) || '[]');
      return Array.isArray(scoped) ? scoped : [];
    } catch { return []; }
  });
  const stablesRef = useRef<StableRow[]>(stables);
  const vasRef = useRef<VaRow[]>(vas);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlightRef = useRef(false);

  const [selectedStable, setSelectedStable] = useState<StableRow | null>(null);
  const [selectedVa, setSelectedVa] = useState<VaRow | null>(null);
  const [receiveStep, setReceiveStep] = useState<ReceiveStep>('method');
  const [africanPolicyRows, setAfricanPolicyRows] = useState<AfricanPolicyRow[]>(() => readCachedAfricanPolicyRows('receive'));
  const [africanPolicyLoading, setAfricanPolicyLoading] = useState(false);
  const africanPolicyLoadingRef = useRef(false);
  const [africanPolicyRequested, setAfricanPolicyRequested] = useState(false);
  const [africanPolicyError, setAfricanPolicyError] = useState('');
  const [selectedAfricanCountryCode, setSelectedAfricanCountryCode] = useState('');
  const [selectedAfricanRail, setSelectedAfricanRail] = useState<{
    channel: AfricanRailChannel;
    currency: string;
    rows: AfricanPolicyRow[];
  } | null>(null);
  const [collectionAmount, setCollectionAmount] = useState('');
  const [collectionPayerName, setCollectionPayerName] = useState('');
  const [collectionPayerEmail, setCollectionPayerEmail] = useState('');
  const [collectionSourceAccount, setCollectionSourceAccount] = useState('');
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionResult, setCollectionResult] = useState<Record<string, unknown> | null>(null);

  const africanCountries = useMemo(() => buildAfricanCountries(africanPolicyRows), [africanPolicyRows]);
  const selectedAfricanCountry = useMemo(
    () => africanCountries.find((item) => item.countryCode === selectedAfricanCountryCode) || null,
    [africanCountries, selectedAfricanCountryCode],
  );
  const selectedAfricanRailOptions = useMemo(
    () => getRailOptions(selectedAfricanCountry),
    [selectedAfricanCountry],
  );
  const africanRailCount = africanPolicyRows.length;
  const selectedAfricanPolicyRow = useMemo(() => {
    if (!selectedAfricanRail) return null;
    const rows = selectedAfricanRail.rows.filter(
      (row) => row.currency === selectedAfricanRail.currency && row.channel === selectedAfricanRail.channel,
    );
    const candidates = rows.length ? rows : selectedAfricanRail.rows;
    return [...candidates].sort((a, b) => {
      const feeFor = (row: AfricanPolicyRow) => {
        const pct = numberFromRaw(row, 'provider_fee_percent');
        const usd = numberFromRaw(row, 'provider_fee_usd');
        const local = numberFromRaw(row, 'provider_fee_local');
        if (pct !== null) return pct;
        if (usd !== null) return usd;
        if (local !== null) return local;
        return Number.POSITIVE_INFINITY;
      };
      const af = feeFor(a);
      const bf = feeFor(b);
      if (af !== bf) return af - bf;
      return b.priority - a.priority;
    })[0] || null;
  }, [selectedAfricanRail]);
  const selectedAfricanProvider = providerFromPolicy(selectedAfricanPolicyRow);
  const receiveUsesFlutterwaveForm = selectedAfricanProvider === 'flutterwave';
  const receiveUsesYellowCardForm = selectedAfricanProvider === 'yellow_card';

  useEffect(() => { stablesRef.current = stables; }, [stables]);
  useEffect(() => { vasRef.current = vas; }, [vas]);

  const loadAfricanReceivePolicy = useCallback(async (force = false) => {
    if (africanPolicyLoadingRef.current) return;
    if (!force && africanPolicyRows.length > 0) return;
    africanPolicyLoadingRef.current = true;
    setAfricanPolicyRequested(true);
    setAfricanPolicyLoading(africanPolicyRows.length === 0);
    setAfricanPolicyError('');
    try {
      const rows = await loadAfricanPolicyRows('receive', {
        force,
        timeoutMs: AFRICAN_POLICY_REQUEST_TIMEOUT_MS,
      });
      setAfricanPolicyRows(rows);
    } catch (error: any) {
      if (africanPolicyRows.length === 0) setAfricanPolicyRows([]);
      setAfricanPolicyError(friendlyError(error?.message, 'Unable to load African receive rails.'));
    } finally {
      africanPolicyLoadingRef.current = false;
      setAfricanPolicyLoading(false);
    }
  }, [africanPolicyRows.length]);

  useEffect(() => {
    if (!africanRailsTester || africanPolicyRows.length > 0) return;
    let active = true;
    void loadAfricanPolicyRows('receive', {
      timeoutMs: AFRICAN_POLICY_REQUEST_TIMEOUT_MS,
    })
      .then((rows) => {
        if (!active) return;
        setAfricanPolicyRows(rows);
        setAfricanPolicyError('');
      })
      .catch(() => {
        // The visible Africa step owns user-facing retry/error state.
      });
    return () => {
      active = false;
    };
  }, [africanRailsTester, africanPolicyRows.length]);

  const shouldRunProviderSync = () => {
    try {
      const key = `borderpay_provider_sync_receive:${userId}`;
      const now = Date.now();
      const last = Number(localStorage.getItem(key) || '0');
      if (Number.isFinite(last) && now - last < 5 * 60 * 1000) return false;
      localStorage.setItem(key, String(now));
      return true;
    } catch {
      return true;
    }
  };

  const refresh = async (force = false) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    const seededStables = stablesRef.current.length > 0 ? stablesRef.current : (() => {
      try {
        const scoped = JSON.parse(localStorage.getItem(stableWalletsCacheKey) || '[]');
        return Array.isArray(scoped) ? scoped : [];
      } catch { return []; }
    })();
    const seededVas = vasRef.current.length > 0 ? vasRef.current : (() => {
      try {
        const scoped = JSON.parse(localStorage.getItem(vaCacheKey) || '[]');
        return Array.isArray(scoped) ? scoped : [];
      } catch { return []; }
    })();
    const isColdStart = seededStables.length === 0 && seededVas.length === 0;
    setRefreshing(true);
    try {
      const last = Number(localStorage.getItem(receiveRefreshTsKey) || '0');
      if (!force && !isColdStart && Number.isFinite(last) && Date.now() - last < 45_000) {
        return;
      }
      const routeData: any = await backendAPI.financial.getReceiveRouteData();
      const sList = (routeData?.data?.stablecoin_wallets as StableRow[]) ?? [];
      const vList = (routeData?.data?.virtual_accounts as VaRow[]) ?? [];
      setStables(sList);
      setVas(vList);
      try { localStorage.setItem(stableWalletsCacheKey, JSON.stringify(sList)); } catch { /* noop */ }
      try { localStorage.setItem(vaCacheKey, JSON.stringify(vList)); } catch { /* noop */ }
      try { localStorage.setItem(receiveRefreshTsKey, String(Date.now())); } catch { /* noop */ }
      void backendAPI.user.getProfile().then((profile: any) => {
        if (!profile?.success || !profile?.data?.user) return;
        const applyProfile = async () => {
          const u = profile.data.user;
          let hydrated = u;
          let profileCountry = normalizedCountry(u?.country);
          if (String(u?.account_type || '').toLowerCase() === 'business') {
            try {
              const br = await backendAPI.business.getProfile();
              if (br?.success && br?.data) {
                hydrated = {
                  ...u,
                  account_type: 'business',
                  bridge_kyb_status: br.data.bridge_kyb_status ?? u.bridge_kyb_status ?? null,
                };
                profileCountry = normalizedCountry(br.data.country) ?? profileCountry;
              }
            } catch {
              // Keep the user profile payload if business profile refresh fails.
            }
          }
          setIsVerified(deriveKycStatus(hydrated) === 'verified');
          setCountry(profileCountry);
          try {
            localStorage.setItem('borderpay_user', JSON.stringify({
              ...hydrated,
              country: profileCountry ?? hydrated.country,
            }));
          } catch { /* noop */ }
        };
        void applyProfile();
      }).catch(() => {
        // Keep cached profile state.
      });
      // Heavy provider sync/provision runs after first paint; never blocks route render.
      if (shouldRunProviderSync()) {
        void Promise.allSettled([
          backendAPI.bridge.syncAccounts(),
        ]).then(async () => {
          try {
            const next: any = await backendAPI.financial.getReceiveRouteData();
            const nextStables = (next?.data?.stablecoin_wallets as StableRow[]) ?? [];
            const nextVas = (next?.data?.virtual_accounts as VaRow[]) ?? [];
            setStables(nextStables);
            setVas(nextVas);
            try { localStorage.setItem(stableWalletsCacheKey, JSON.stringify(nextStables)); } catch { /* noop */ }
            try { localStorage.setItem(vaCacheKey, JSON.stringify(nextVas)); } catch { /* noop */ }
          } catch {
            // keep first snapshot
          }
        });
      }
    } catch {
      // Keep cached data visible; refresh is best-effort.
    } finally {
      setLoading(false);
      setRefreshing(false);
      refreshInFlightRef.current = false;
    }
  };

  const resetAfricanReceiveFlow = () => {
    setSelectedAfricanCountryCode('');
    setSelectedAfricanRail(null);
    setReceiveStep('method');
    setCollectionAmount('');
    setCollectionPayerName('');
    setCollectionPayerEmail('');
    setCollectionSourceAccount('');
    setCollectionResult(null);
  };

  const goBack = () => {
    if (receiveStep === 'africa-success') {
      resetAfricanReceiveFlow();
      return;
    }
    if (receiveStep === 'africa-review') {
      setReceiveStep('africa-details');
      return;
    }
    if (receiveStep === 'africa-details') {
      setSelectedAfricanRail(null);
      setCollectionResult(null);
      setReceiveStep('africa-rail');
      return;
    }
    if (receiveStep === 'africa-rail') {
      setSelectedAfricanCountryCode('');
      setSelectedAfricanRail(null);
      setReceiveStep('africa-destination');
      return;
    }
    if (receiveStep === 'africa-destination') {
      resetAfricanReceiveFlow();
      return;
    }
    onBack();
  };

  const createAfricanCollection = async () => {
    if (!selectedAfricanCountry || !selectedAfricanRail) return;
    const amount = Number(collectionAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount.');
      return;
    }
    if (selectedAfricanProvider !== 'flutterwave' && selectedAfricanProvider !== 'yellow_card') {
      toast.error('This receive corridor is not available yet.');
      return;
    }
    if (receiveUsesFlutterwaveForm && (!collectionPayerName.trim() || !collectionPayerEmail.trim())) {
      toast.error('Enter the payer name and email for this collection.');
      return;
    }
    if (receiveUsesFlutterwaveForm && selectedAfricanRail.channel === 'mobile_money' && !isLikelyInternationalPhone(collectionSourceAccount, selectedAfricanCountry.countryCode)) {
      toast.error(`Enter a valid ${selectedAfricanCountry.countryName} mobile money number.`);
      return;
    }
    if (receiveUsesYellowCardForm && selectedAfricanRail.channel === 'mobile_money' && !isLikelyInternationalPhone(collectionSourceAccount, selectedAfricanCountry.countryCode)) {
      toast.error(`Enter a valid ${selectedAfricanCountry.countryName} mobile money number.`);
      return;
    }
    setCollectionLoading(true);
    setCollectionResult(null);
    try {
      const txRef = `bp-collect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const sourceAccount = selectedAfricanRail.channel === 'mobile_money'
        ? formatInternationalPhone(collectionSourceAccount, selectedAfricanCountry.countryCode)
        : collectionSourceAccount.trim();
      const res: any = await backendAPI.payouts.createCollection({
        source: selectedAfricanProvider === 'yellow_card' ? 'yellow_card' : 'flutterwave',
        amount,
        currency: selectedAfricanRail.currency,
        country: selectedAfricanCountry.countryCode,
        destination_country: selectedAfricanCountry.countryCode,
        destination_currency: selectedAfricanRail.currency,
        channel: selectedAfricanRail.channel,
        account_number: sourceAccount || undefined,
        phone: selectedAfricanRail.channel === 'mobile_money' ? sourceAccount || undefined : undefined,
        network_id: selectedAfricanPolicyRow?.raw?.provider_network_id
          ? String(selectedAfricanPolicyRow.raw.provider_network_id)
          : undefined,
        tx_ref: txRef,
        reference: txRef,
        fullname: receiveUsesFlutterwaveForm ? collectionPayerName.trim() || undefined : undefined,
        email: receiveUsesFlutterwaveForm ? collectionPayerEmail.trim() || undefined : undefined,
        customer: receiveUsesFlutterwaveForm
          ? {
            name: collectionPayerName.trim() || undefined,
            email: collectionPayerEmail.trim() || undefined,
          }
          : undefined,
        yellow_card: receiveUsesYellowCardForm
          ? {
            source: {
              accountNumber: sourceAccount || undefined,
              accountType: selectedAfricanRail.channel === 'mobile_money' ? 'momo' : 'bank',
              networkId: selectedAfricanPolicyRow?.raw?.provider_network_id,
            },
          }
          : undefined,
        meta: {
          borderpay_ui_route: 'receive_from_africa',
          selected_channel: selectedAfricanRail.channel,
          selected_provider: selectedAfricanProvider || undefined,
        },
      });
      if (!res?.success) throw new Error(res?.error || 'Could not create collection request.');
      const data = res.data || {};
      setCollectionResult(data);
      setReceiveStep('africa-success');
      toast.success('Collection request created.');
    } catch (error: any) {
      toast.error(friendlyError(error?.message, 'Could not create collection request.'));
    } finally {
      setCollectionLoading(false);
    }
  };

  useEffect(() => { setIsVerified(readCachedVerified()); }, [userId]);
  useEffect(() => {
    const prewarmKey = `borderpay_receive_prewarm_v1:${userId}`;
    try {
      const last = Number(sessionStorage.getItem(prewarmKey) || '0');
      if (!Number.isFinite(last) || Date.now() - last >= 180_000) {
        const prefetch = (window as any).__borderpay_prefetch;
        if (typeof prefetch === 'function') {
          const warm = () => {
            ['wallet-detail', 'send-money', 'transactions', 'exchange', 'external-accounts'].forEach((s) => {
              try { prefetch(s); } catch { /* noop */ }
            });
          };
          const ric = (window as any).requestIdleCallback;
          if (typeof ric === 'function') ric(warm, { timeout: 1000 });
          else setTimeout(warm, 120);
        }
        sessionStorage.setItem(prewarmKey, String(Date.now()));
      }
    } catch { /* noop */ }

    if (isVerified) {
      refresh();
    }
    const onFocus = () => {
      if (isVerified) {
        void refresh();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && isVerified) void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  /* eslint-disable-next-line */ }, [userId, isVerified, receiveRefreshTsKey]);

  const visibleVas = useMemo(() => {
    const order: Record<string, number> = { GBP: 0, EUR: 1, USD: 2 };
    return vas.filter((v) => {
      const currency = String(v.currency || '').toUpperCase() as BridgeVirtualAccountCurrency;
      return ['USD', 'EUR', 'GBP'].includes(currency) &&
        String(v.status || '').toLowerCase() === 'active' &&
        Boolean(v.bridge_virtual_account_id);
    }).sort((a, b) => (order[String(a.currency).toUpperCase()] ?? 99) - (order[String(b.currency).toUpperCase()] ?? 99));
  }, [vas]);

  const visibleStableRows = useMemo(() => {
    const byCurrency = new Map<string, StableRow>();
    stables.forEach((row) => {
      const rawSym = String(row.currency || '').toUpperCase();
      const sym = rawSym || (String(row.chain).toLowerCase() === 'tron' ? 'USDT' : 'USDC');
      if ((sym === 'USDC' || sym === 'USDT') && !byCurrency.has(sym)) {
        byCurrency.set(sym, { ...row, currency: sym });
      }
    });
    return ['USDC', 'USDT'].map((symbol) => byCurrency.get(symbol)).filter(Boolean) as StableRow[];
  }, [stables]);

  const collectionAmountNumber = useMemo(() => {
    const n = Number(collectionAmount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [collectionAmount]);

  const collectionFee = useMemo(() => {
    if (!selectedAfricanPolicyRow || collectionAmountNumber <= 0) return null;
    const pct = numberFromRaw(selectedAfricanPolicyRow, 'provider_fee_percent');
    const local = numberFromRaw(selectedAfricanPolicyRow, 'provider_fee_local');
    const usd = numberFromRaw(selectedAfricanPolicyRow, 'provider_fee_usd');
    if (pct !== null) return { amount: (collectionAmountNumber * pct) / 100, currency: selectedAfricanRail?.currency || '', percent: pct };
    if (local !== null) return { amount: local, currency: selectedAfricanRail?.currency || '', percent: null };
    if (usd !== null) return { amount: usd, currency: 'USD', percent: null };
    return null;
  }, [collectionAmountNumber, selectedAfricanPolicyRow, selectedAfricanRail?.currency]);

  const collectionReceiveNet = useMemo(() => {
    if (collectionAmountNumber <= 0) return 0;
    if (!collectionFee || collectionFee.currency !== selectedAfricanRail?.currency) return collectionAmountNumber;
    return Math.max(0, collectionAmountNumber - collectionFee.amount);
  }, [collectionAmountNumber, collectionFee, selectedAfricanRail?.currency]);

  const canCreateAfricanCollection = useMemo(() => {
    if (collectionAmountNumber <= 0) return false;
    if (selectedAfricanProvider !== 'flutterwave' && selectedAfricanProvider !== 'yellow_card') return false;
    if (receiveUsesFlutterwaveForm) {
      if (!collectionPayerName.trim() || !collectionPayerEmail.trim()) return false;
      if (selectedAfricanRail?.channel === 'mobile_money') return isLikelyInternationalPhone(collectionSourceAccount, selectedAfricanCountryCode);
      return true;
    }
    if (receiveUsesYellowCardForm && selectedAfricanRail?.channel === 'mobile_money') {
      return isLikelyInternationalPhone(collectionSourceAccount, selectedAfricanCountryCode);
    }
    return true;
  }, [
    collectionAmountNumber,
    collectionPayerEmail,
    collectionPayerName,
    collectionSourceAccount,
    receiveUsesFlutterwaveForm,
    receiveUsesYellowCardForm,
    selectedAfricanRail?.channel,
    selectedAfricanProvider,
    selectedAfricanCountryCode,
  ]);

  // ── KYC gate ─────────────────────────────────────────────────────────────
  if (!isVerified) {
    return (
      <div className={`min-h-screen ${tc.bg}`}>
        <FloatingBackButton onBack={onBack} />
        <div className="max-w-2xl mx-auto px-5 pt-floating-back pb-10">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
            {tt('receive.title', 'Receive funds')}
          </p>
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-8 text-center`}>
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-amber-400" />
            </div>
            <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>Verification required</h2>
            <p className={`text-sm ${tc.textMuted} max-w-sm mx-auto mb-6 leading-relaxed`}>
              Complete identity verification to open accounts and digital dollar wallets others can pay you on.
            </p>
            <button onClick={onBack} className={`text-[12px] font-semibold ${tc.textSecondary} hover:${tc.text}`}>Back</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <FloatingBackButton onBack={goBack} />
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-floating-back pb-28">

        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>
            {tt('receive.title', 'Receive funds')}
          </p>
          <button onClick={() => refresh(true)} aria-label="Refresh"
            className={`p-2 rounded-full ${tc.hoverBg} ${refreshing ? 'opacity-60' : ''}`}>
            <RefreshCw className={`w-4 h-4 ${tc.textMuted} ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {receiveStep === 'method' && (
          <>
            <div className={`mb-5 rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3.5 flex items-start gap-3`}>
              <Inbox className="w-4 h-4 text-[#C7FF00] mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${tc.text}`}>How others pay you</p>
                <p className={`text-[11px] ${tc.textMuted} mt-0.5 leading-snug`}>
                  Choose a receive method, then share the account, wallet, or collection details with the sender.
                </p>
              </div>
            </div>

            <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
              Receive money
            </h2>

            <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden mb-6`}>
              <button
                type="button"
                onClick={() => {
                  if (!africanRailsTester) return;
                  setReceiveStep('africa-destination');
                  void loadAfricanReceivePolicy();
                }}
                disabled={!africanRailsTester}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${africanRailsTester ? tc.hoverBg : 'cursor-not-allowed opacity-60'}`}
              >
                <div className="w-11 h-11 rounded-xl bg-[#58D66D]/12 border border-[#58D66D]/25 flex items-center justify-center flex-shrink-0">
                  <Smartphone className="w-5 h-5 text-[#58D66D]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-[15px] font-semibold ${tc.text} truncate`}>Receive to Africa</div>
                  <div className="text-[11px] text-[#58D66D]">
                    {africanRailsTester ? 'Mobile money and local bank collections' : 'Coming soon'}
                  </div>
                  {!africanRailsTester && (
                    <div className="text-[11px] text-white/40">Sandbox review in progress</div>
                  )}
                </div>
                {africanRailsTester ? (
                  <ChevronRight className={`w-4 h-4 ${tc.textMuted} flex-shrink-0 ml-1`} />
                ) : (
                  <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white/60">
                    Soon
                  </span>
                )}
              </button>

              {loading ? (
                <div className={`border-t ${tc.borderLight} px-4 py-8 text-center`}>
                  <Loader2 className={`w-5 h-5 ${tc.textMuted} animate-spin mx-auto`} />
                </div>
              ) : visibleVas.length === 0 && visibleStableRows.length === 0 ? (
                <div className={`border-t ${tc.borderLight} px-4 py-8 text-center`}>
                  <p className={`text-sm ${tc.textMuted}`}>No global account or digital dollar receive rails available yet.</p>
                </div>
              ) : (
                <>
                  {visibleVas.map((v) => {
                    const cur = String(v.currency).toUpperCase();
                    return (
                      <button key={v.id} onClick={() => setSelectedVa(v)}
                        className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${tc.hoverBg} border-t ${tc.borderLight}`}>
                        <AssetBadge symbol={cur} size={44} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-[15px] font-semibold ${tc.text} truncate`}>{cur}</div>
                          <div className={`text-[11px] ${tc.textMuted}`}>{RAIL_NAME[cur] ?? 'Bank transfer'} account</div>
                        </div>
                        <span className={`text-[10px] uppercase tracking-wider ${tc.textMuted} hidden xs:inline`}>View details</span>
                        <ChevronRight className={`w-4 h-4 ${tc.textMuted} flex-shrink-0 ml-1`} />
                      </button>
                    );
                  })}

                  {visibleStableRows.map((s) => {
                    const sym = String(s.currency || '').toUpperCase();
                    return (
                      <button key={s.id} onClick={() => setSelectedStable(s)}
                        className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${tc.hoverBg} border-t ${tc.borderLight}`}>
                        <AssetBadge symbol={sym} size={44} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-[15px] font-semibold ${tc.text} truncate`}>{sym}</div>
                          <div className={`text-[11px] ${tc.textMuted}`}>{chainLabel(s.chain)} digital dollar deposit address</div>
                        </div>
                        <span className={`text-[10px] uppercase tracking-wider ${tc.textMuted} hidden xs:inline`}>View address</span>
                        <ChevronRight className={`w-4 h-4 ${tc.textMuted} flex-shrink-0 ml-1`} />
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </>
        )}

        {receiveStep === 'africa-destination' && (
          <>
            <div className="mb-4">
              <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>Receive to Africa</p>
              <p className={`mt-1 text-sm ${tc.textSecondary}`}>
                {africanPolicyLoading
                  ? 'Loading available countries'
                  : africanRailCount > 0
                    ? `${africanCountries.length} countries · ${africanRailCount} rails`
                    : 'Choose a corridor'}
              </p>
            </div>

            <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden mb-6`}>
              {!selectedAfricanCountry && !selectedAfricanRail && (
            <>
              <div className={`px-4 py-3 border-b ${tc.borderLight} flex items-center justify-between gap-3`}>
                <div>
                  <p className={`text-sm font-semibold ${tc.text}`}>African corridors</p>
                  <p className={`text-[11px] ${tc.textMuted}`}>
                    {africanPolicyLoading
                      ? 'Loading available receive rails'
                      : africanRailCount > 0
                        ? `${africanCountries.length} countries · ${africanRailCount} rails`
                        : 'Load countries to create a collection request'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => loadAfricanReceivePolicy(true)}
                  aria-label="Refresh African rails"
                  className={`p-2 rounded-full ${tc.hoverBg} ${africanPolicyLoading ? 'opacity-60' : ''}`}
                >
                  <RefreshCw className={`w-4 h-4 ${tc.textMuted} ${africanPolicyLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {africanPolicyLoading && (
                <div className="px-4 py-8 text-center">
                  <Loader2 className={`w-5 h-5 ${tc.textMuted} animate-spin mx-auto`} />
                </div>
              )}

              {!africanPolicyLoading && !africanPolicyRequested && africanCountries.length === 0 && (
                <div className="px-4 py-6">
                  <button
                    type="button"
                    onClick={() => loadAfricanReceivePolicy(true)}
                    className="w-full h-11 rounded-2xl bg-[#C7FF00] text-black text-sm font-bold"
                  >
                    Load African rails
                  </button>
                  <p className={`mt-2 text-[11px] ${tc.textMuted}`}>
                    Existing account and stablecoin receive options stay available below.
                  </p>
                </div>
              )}

              {!africanPolicyLoading && africanPolicyError && (
                <div className="px-4 py-6">
                  <p className={`text-sm font-semibold ${tc.text}`}>Could not load African receive rails</p>
                  <p className={`text-xs ${tc.textMuted} mt-1`}>{africanPolicyError}</p>
                  <button
                    type="button"
                    onClick={() => loadAfricanReceivePolicy(true)}
                    className="mt-4 h-10 px-4 rounded-xl bg-[#C7FF00] text-black text-sm font-semibold"
                  >
                    Retry
                  </button>
                </div>
              )}

              {!africanPolicyLoading && !africanPolicyError && africanCountries.map((countryOption, index) => {
                const rails = getRailOptions(countryOption);
                return (
                  <button
                    key={countryOption.countryCode}
                    type="button"
                    onClick={() => {
                      setSelectedAfricanCountryCode(countryOption.countryCode);
                      setSelectedAfricanRail(null);
                      setCollectionResult(null);
                      setReceiveStep('africa-rail');
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${tc.hoverBg} ${index > 0 ? `border-t ${tc.borderLight}` : ''}`}
                  >
                    <div className="w-11 h-11 rounded-full bg-black border border-white/15 flex items-center justify-center text-[28px] overflow-hidden">
                      {countryOption.flag}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[15px] font-semibold ${tc.text} truncate`}>{countryOption.countryName}</div>
                      <div className={`text-[11px] ${tc.textMuted}`}>{rails.map((rail) => railLabel(rail.channel)).join(' · ')}</div>
                    </div>
                    <span className={`text-[10px] uppercase tracking-wider ${tc.textMuted} hidden xs:inline`}>
                      {rails.length} {rails.length === 1 ? 'rail' : 'rails'}
                    </span>
                    <ChevronRight className={`w-4 h-4 ${tc.textMuted} flex-shrink-0 ml-1`} />
                  </button>
                );
              })}
            </>
          )}
            </div>
          </>
        )}

        {receiveStep === 'africa-rail' && selectedAfricanCountry && (
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden mb-6`}>
            <>
              <div className={`px-4 py-3 border-b ${tc.borderLight} flex items-center gap-3`}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAfricanCountryCode('');
                    setReceiveStep('africa-destination');
                  }}
                  className={`w-9 h-9 rounded-full ${tc.hoverBg} flex items-center justify-center`}
                  aria-label="Back to African countries"
                >
                  <ArrowLeft className={`w-4 h-4 ${tc.textMuted}`} />
                </button>
                <div className="w-11 h-11 rounded-full bg-black border border-white/15 flex items-center justify-center text-[28px] overflow-hidden">
                  {selectedAfricanCountry.flag}
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${tc.text}`}>{selectedAfricanCountry.countryName}</p>
                  <p className={`text-[11px] ${tc.textMuted}`}>Choose a receive rail</p>
                </div>
              </div>

              {selectedAfricanRailOptions.map((rail, index) => (
                <button
                  key={`${selectedAfricanCountry.countryCode}-${rail.channel}`}
                  type="button"
                  onClick={() => {
                    setSelectedAfricanRail(rail);
                    setCollectionAmount('');
                    setCollectionPayerName('');
                    setCollectionPayerEmail('');
                    setCollectionSourceAccount('');
                    setCollectionResult(null);
                    setReceiveStep('africa-details');
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${tc.hoverBg} ${index > 0 ? `border-t ${tc.borderLight}` : ''}`}
                >
                  <div className="w-11 h-11 rounded-xl bg-[#C7FF00]/10 flex items-center justify-center flex-shrink-0">
                    <RailIcon channel={rail.channel} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[15px] font-semibold ${tc.text} truncate`}>{railLabel(rail.channel)}</div>
                    <div className={`text-[11px] ${tc.textMuted}`}>Create {rail.currency} collection request</div>
                  </div>
                  <ChevronRight className={`w-4 h-4 ${tc.textMuted} flex-shrink-0 ml-1`} />
                </button>
              ))}
            </>
          </div>
        )}

        {receiveStep === 'africa-details' && selectedAfricanCountry && selectedAfricanRail && (
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden mb-6`}>
            <div className="p-4">
              <div className="flex items-center gap-3 mb-4">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAfricanRail(null);
                    setCollectionResult(null);
                    setReceiveStep('africa-rail');
                  }}
                  className={`w-9 h-9 rounded-full ${tc.hoverBg} flex items-center justify-center`}
                  aria-label="Back to receive rails"
                >
                  <ArrowLeft className={`w-4 h-4 ${tc.textMuted}`} />
                </button>
                <div>
                  <p className={`text-sm font-semibold ${tc.text}`}>
                    {railLabel(selectedAfricanRail.channel)} · {selectedAfricanCountry.countryName}
                  </p>
                  <p className={`text-[11px] ${tc.textMuted}`}>{selectedAfricanRail.currency} collection request</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className={`text-xs font-medium ${tc.textMuted} mb-1.5 block`}>Amount</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={collectionAmount}
                    onChange={(e) => setCollectionAmount(e.target.value)}
                    placeholder={`0.00 ${selectedAfricanRail.currency}`}
                    className={`w-full ${tc.inputBg} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50`}
                  />
                </div>
                {receiveUsesFlutterwaveForm && (
                  <>
                    <div>
                      <label className={`text-xs font-medium ${tc.textMuted} mb-1.5 block`}>Payer name</label>
                      <input
                        type="text"
                        value={collectionPayerName}
                        onChange={(e) => setCollectionPayerName(e.target.value)}
                        placeholder="Sender name"
                        className={`w-full ${tc.inputBg} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50`}
                      />
                    </div>
                    <div>
                      <label className={`text-xs font-medium ${tc.textMuted} mb-1.5 block`}>Payer email</label>
                      <input
                        type="email"
                        value={collectionPayerEmail}
                        onChange={(e) => setCollectionPayerEmail(e.target.value)}
                        placeholder="sender@example.com"
                        className={`w-full ${tc.inputBg} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50`}
                      />
                    </div>
                    {selectedAfricanRail.channel === 'mobile_money' && (
                      <div>
                        <label className={`text-xs font-medium ${tc.textMuted} mb-1.5 block`}>Payer mobile money number</label>
                        <input
                          type="text"
                          inputMode="tel"
                          value={collectionSourceAccount}
                          onChange={(e) => setCollectionSourceAccount(e.target.value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, ''))}
                          onBlur={() => setCollectionSourceAccount(formatInternationalPhone(collectionSourceAccount, selectedAfricanCountry.countryCode))}
                          placeholder={`+${COUNTRY_DIAL_CODES[selectedAfricanCountry.countryCode] || '254'}7xxxxxxxx`}
                          className={`w-full ${tc.inputBg} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50`}
                        />
                      </div>
                    )}
                  </>
                )}

                {receiveUsesYellowCardForm && (
                  <div>
                    <label className={`text-xs font-medium ${tc.textMuted} mb-1.5 block`}>
                      {selectedAfricanRail.channel === 'mobile_money' ? 'Payer mobile money number' : 'Payer account number'}
                    </label>
                    <input
                      type="text"
                      inputMode={selectedAfricanRail.channel === 'mobile_money' ? 'tel' : 'numeric'}
                      value={collectionSourceAccount}
                      onChange={(e) => {
                        const next = selectedAfricanRail.channel === 'mobile_money'
                          ? e.target.value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '')
                          : e.target.value.replace(/\D/g, '');
                        setCollectionSourceAccount(next);
                      }}
                      onBlur={() => {
                        if (selectedAfricanRail.channel === 'mobile_money') {
                          setCollectionSourceAccount(formatInternationalPhone(collectionSourceAccount, selectedAfricanCountry.countryCode));
                        }
                      }}
                      placeholder={selectedAfricanRail.channel === 'mobile_money' ? `+${COUNTRY_DIAL_CODES[selectedAfricanCountry.countryCode] || '254'}7xxxxxxxx` : 'Optional for bank collection'}
                      className={`w-full ${tc.inputBg} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50`}
                    />
                    {selectedAfricanRail.channel === 'bank' && (
                      <p className={`mt-1.5 px-1 text-[11px] ${tc.textMuted}`}>
                        Leave blank if the bank rail does not require payer account details.
                      </p>
                    )}
                  </div>
                )}

                {collectionResult && (
                  <div className="rounded-2xl border border-[#C7FF00]/20 bg-[#C7FF00]/10 p-3">
                    <p className="text-sm font-semibold text-[#C7FF00]">Collection request created</p>
                    <p className={`text-[11px] ${tc.textMuted} mt-1`}>
                      Status: {String((collectionResult as any).status || 'submitted')}
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setReceiveStep('africa-review')}
                  disabled={!canCreateAfricanCollection}
                  className="w-full h-12 rounded-full bg-[#C7FF00] text-black text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Review request
                </button>

                <button
                  type="button"
                  onClick={resetAfricanReceiveFlow}
                  className={`w-full h-10 rounded-xl text-sm font-semibold ${tc.textMuted} ${tc.hoverBg}`}
                >
                  Clear selection
                </button>
              </div>
            </div>
          </div>
        )}

        {receiveStep === 'africa-review' && selectedAfricanCountry && selectedAfricanRail && (
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden mb-6`}>
            <div className="p-4">
              <div className="flex items-center gap-3 mb-5">
                <button
                  type="button"
                  onClick={() => setReceiveStep('africa-details')}
                  className={`w-9 h-9 rounded-full ${tc.hoverBg} flex items-center justify-center`}
                  aria-label="Back to receive details"
                >
                  <ArrowLeft className={`w-4 h-4 ${tc.textMuted}`} />
                </button>
                <div>
                  <p className={`text-sm font-semibold ${tc.text}`}>Confirm collection request</p>
                  <p className={`text-[11px] ${tc.textMuted}`}>
                    {selectedAfricanCountry.flag} {railLabel(selectedAfricanRail.channel)} · {selectedAfricanRail.currency}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className={`rounded-2xl ${tc.inputBg} border ${tc.borderLight} p-4`}>
                  <p className={`text-xs ${tc.textMuted}`}>Payer sends</p>
                  <p className={`mt-1 text-3xl font-bold ${tc.text}`}>
                    {formatMoney(collectionAmountNumber, selectedAfricanRail.currency)}
                  </p>
                  <p className={`mt-1 text-xs ${tc.textMuted}`}>{selectedAfricanRail.currency}</p>
                </div>

                <div className={`rounded-2xl ${tc.inputBg} border ${tc.borderLight} p-4`}>
                  <p className={`text-xs ${tc.textMuted}`}>You receive</p>
                  <p className="mt-1 text-3xl font-bold text-[#C7FF00]">
                    {formatMoney(collectionReceiveNet, selectedAfricanRail.currency)}
                  </p>
                  <p className={`mt-1 text-xs ${tc.textMuted}`}>After transaction fee, when completed</p>
                </div>

                <div className="space-y-2 py-1">
                  <div className="flex justify-between gap-4 text-xs">
                    <span className={tc.textMuted}>Country</span>
                    <span className={`${tc.text} text-right`}>{selectedAfricanCountry.flag} {selectedAfricanCountry.countryName}</span>
                  </div>
                  <div className="flex justify-between gap-4 text-xs">
                    <span className={tc.textMuted}>Payment method</span>
                    <span className={`${tc.text} text-right`}>{railLabel(selectedAfricanRail.channel)}</span>
                  </div>
                  {collectionPayerName.trim() && (
                    <div className="flex justify-between gap-4 text-xs">
                      <span className={tc.textMuted}>Payer name</span>
                      <span className={`${tc.text} text-right`}>{collectionPayerName.trim()}</span>
                    </div>
                  )}
                  {collectionPayerEmail.trim() && (
                    <div className="flex justify-between gap-4 text-xs">
                      <span className={tc.textMuted}>Payer email</span>
                      <span className={`${tc.text} text-right break-all`}>{collectionPayerEmail.trim()}</span>
                    </div>
                  )}
                  {collectionSourceAccount.trim() && (
                    <div className="flex justify-between gap-4 text-xs">
                      <span className={tc.textMuted}>
                        {selectedAfricanRail.channel === 'mobile_money' ? 'Mobile money number' : 'Account number'}
                      </span>
                      <span className={`${tc.text} text-right font-mono`}>
                        {selectedAfricanRail.channel === 'mobile_money'
                          ? formatInternationalPhone(collectionSourceAccount, selectedAfricanCountry.countryCode)
                          : collectionSourceAccount.trim()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between gap-4 text-xs">
                    <span className={tc.textMuted}>
                      Transaction fee{collectionFee?.percent ? ` (${collectionFee.percent.toFixed(collectionFee.percent < 1 ? 2 : 3)}%)` : ''}
                    </span>
                    <span className={`${tc.text} text-right`}>
                      {collectionFee
                        ? `${formatMoney(collectionFee.amount, collectionFee.currency)} ${collectionFee.currency}`
                        : 'Included in quote'}
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-400" />
                  <p className="text-xs leading-relaxed text-yellow-300">
                    Confirm only after checking the amount and payer details. BorderPay will handle the next step through the selected rail.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={createAfricanCollection}
                  disabled={collectionLoading || !canCreateAfricanCollection}
                  className="w-full h-12 rounded-full bg-[#C7FF00] text-black text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {collectionLoading ? 'Creating request...' : 'Confirm request'}
                </button>
              </div>
            </div>
          </div>
        )}

        {receiveStep === 'africa-success' && selectedAfricanCountry && selectedAfricanRail && (
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-6 text-center mb-6`}>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15">
              <CheckCircle className="h-9 w-9 text-green-400" />
            </div>
            <h2 className={`text-xl font-bold ${tc.text}`}>Collection request created</h2>
            <p className={`mt-2 text-sm ${tc.textMuted}`}>
              {formatMoney(collectionAmountNumber, selectedAfricanRail.currency)} {selectedAfricanRail.currency} · {selectedAfricanCountry.countryName}
            </p>
            {collectionResult && (
              <div className={`mt-5 rounded-2xl ${tc.inputBg} border ${tc.borderLight} p-4 text-left`}>
                <div className="flex justify-between gap-4 text-xs">
                  <span className={tc.textMuted}>Status</span>
                  <span className={`${tc.text} text-right`}>{String((collectionResult as any).status || 'submitted')}</span>
                </div>
                {((collectionResult as any).reference || (collectionResult as any).tx_ref || (collectionResult as any).id) && (
                  <div className="mt-2 flex justify-between gap-4 text-xs">
                    <span className={tc.textMuted}>Reference</span>
                    <span className={`${tc.text} max-w-[190px] truncate text-right font-mono`}>
                      {String((collectionResult as any).reference || (collectionResult as any).tx_ref || (collectionResult as any).id)}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={resetAfricanReceiveFlow}
                className="w-full h-12 rounded-full bg-[#C7FF00] text-black text-sm font-bold"
              >
                Create another request
              </button>
              <button
                type="button"
                onClick={onBack}
                className={`w-full h-11 rounded-full border ${tc.borderLight} ${tc.text} text-sm font-semibold ${tc.hoverBg}`}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail sheets — same components the Wallet tab uses */}
      <WalletDetailSheet open={!!selectedStable} onClose={() => setSelectedStable(null)}
        wallet={selectedStable ? { currency: selectedStable.currency, chain: selectedStable.chain, address: selectedStable.address } : null} />
      <AccountDetailSheet open={!!selectedVa} onClose={() => setSelectedVa(null)}
        va={selectedVa ? { currency: selectedVa.currency, rail: selectedVa.rail, status: selectedVa.status, account_details: selectedVa.account_details } : null} />
    </div>
  );
}

export default ReceiveMoneyScreen;
