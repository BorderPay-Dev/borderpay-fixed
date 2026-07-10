import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useThemeClasses, useThemeLanguage } from '../../utils/i18n/ThemeLanguageContext';
import { backendAPI } from '../../utils/api/backendAPI';
import { AssetBadge } from '../dashboard/bridge/WalletVisuals';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { financialCacheKey } from '../../utils/financial/cacheScope';
import { SkeletonRows } from '../common/Skeleton';
import { localRailForStoredUser } from '../../utils/presentation/africanRailDisplay';

interface AddWalletScreenProps {
  userId: string;
  onBack: () => void;
}

interface StableRow { id: string; currency: string }
interface VaRow { id: string; currency: string; status?: string; account_details?: any }

type WalletType = 'virtual_account' | 'stablecoin';

type WalletCard = {
  code: string;
  type: WalletType;
  title: string;
  subtitle: string;
};

const CARDS: WalletCard[] = [
  { code: 'USD', type: 'virtual_account', title: 'US Dollar', subtitle: 'Global receive account' },
  { code: 'EUR', type: 'virtual_account', title: 'Euro', subtitle: 'Global receive account' },
  { code: 'GBP', type: 'virtual_account', title: 'British Pound', subtitle: 'Global receive account' },
  { code: 'USDC', type: 'stablecoin', title: 'USD Coin', subtitle: 'Stablecoin wallet' },
  { code: 'USDT', type: 'stablecoin', title: 'Tether USD', subtitle: 'Stablecoin wallet' },
];

const STABLE_ICON_URL: Record<string, string> = {
  USDC: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/usdc.png',
  USDT: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/usdt.png',
};
const INACTIVE_VA_STATUSES = new Set(['inactive', 'deactivated', 'disabled', 'closed', 'archived', 'cancelled', 'canceled', 'rejected', 'suspended', 'blocked']);
const ACTIVE_VA_STATUSES = new Set(['active', 'activated']);

function getVaStatus(row?: VaRow): string {
  return String(row?.account_details?.status || row?.status || 'active').trim().toLowerCase();
}

export function AddWalletScreen({ userId, onBack }: AddWalletScreenProps) {
  const tc = useThemeClasses();
  const { t } = useThemeLanguage();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const walletCacheKey = useMemo(
    () => financialCacheKey('borderpay_wallets_v3', { userId }),
    [userId],
  );
  const vaCacheKey = useMemo(
    () => financialCacheKey('borderpay_va_v3', { userId }),
    [userId],
  );
  const walletRefreshTsKey = useMemo(
    () => financialCacheKey('borderpay_wallet_refresh_ts_v3', { userId }),
    [userId],
  );
  const hasFreshWalletCache = useMemo(() => {
    try {
      const last = Number(localStorage.getItem(walletRefreshTsKey) || '0');
      return Number.isFinite(last) && Date.now() - last < 60_000;
    } catch {
      return false;
    }
  }, [walletRefreshTsKey]);
  const [stableRows, setStableRows] = useState<StableRow[]>(() => {
    try {
      const scoped = JSON.parse(localStorage.getItem(walletCacheKey) || '[]');
      return Array.isArray(scoped) ? scoped : [];
    } catch {
      return [];
    }
  });
  const [vaRows, setVaRows] = useState<VaRow[]>(() => {
    try {
      const scoped = JSON.parse(localStorage.getItem(vaCacheKey) || '[]');
      return Array.isArray(scoped) ? scoped : [];
    } catch {
      return [];
    }
  });
  const [requesting, setRequesting] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [supportedVaCurrencies, setSupportedVaCurrencies] = useState<Set<string>>(new Set());
  const [initialRefreshDone, setInitialRefreshDone] = useState(hasFreshWalletCache);
  const refreshInFlightRef = useRef(false);
  const localRail = useMemo(() => localRailForStoredUser(), []);

  const refresh = async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      await Promise.race([
        backendAPI.bridge.syncAccounts(),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
      const [route, caps]: any[] = await Promise.all([
        backendAPI.financial.getWalletRouteData(),
        backendAPI.bridge.virtualAccount.capabilities().catch(() => null),
      ]);
      const routeData = route?.data || {};
      const nextStable = Array.isArray(routeData?.stablecoin_wallets) ? routeData.stablecoin_wallets : [];
      const nextVa = Array.isArray(routeData?.virtual_accounts) ? routeData.virtual_accounts : [];
      const wallets = Array.isArray(routeData?.wallets) ? routeData.wallets : [];
      setStableRows(nextStable);
      setVaRows(nextVa);
      const supported = Array.isArray(caps?.data?.supported_currencies)
        ? caps.data.supported_currencies.map((c: any) => String(c || '').toUpperCase())
        : [];
      setSupportedVaCurrencies(new Set(supported));
      try { localStorage.setItem(walletCacheKey, JSON.stringify(nextStable)); } catch { /* noop */ }
      try { localStorage.setItem(vaCacheKey, JSON.stringify(nextVa)); } catch { /* noop */ }

      const total = wallets
        .filter((row: any) => ['USDC', 'USDT'].includes(String(row?.currency || '').toUpperCase()))
        .reduce((sum: number, row: any) => sum + Number(row?.balance || 0), 0);
      try { localStorage.setItem(`borderpay_wallet_total_v2_${userId}`, String(total)); } catch { /* noop */ }
    } finally {
      setInitialRefreshDone(true);
      refreshInFlightRef.current = false;
    }
  };

  useEffect(() => {
    void refresh();
  }, [userId]);

  const existingStable = useMemo(
    () => new Set(stableRows.map((r) => String(r.currency || '').toUpperCase())),
    [stableRows],
  );
  const existingVa = useMemo(
    () => new Set(vaRows.map((r) => String(r.currency || '').toUpperCase())),
    [vaRows],
  );
  const vaByCurrency = useMemo(() => {
    const map = new Map<string, VaRow>();
    for (const row of vaRows) {
      const currency = String(row.currency || '').toUpperCase();
      if (!currency) continue;
      const existing = map.get(currency);
      if (!existing) {
        map.set(currency, row);
        continue;
      }
      const existingStatus = getVaStatus(existing);
      const nextStatus = getVaStatus(row);
      if (!ACTIVE_VA_STATUSES.has(existingStatus) && ACTIVE_VA_STATUSES.has(nextStatus)) {
        map.set(currency, row);
      }
    }
    return map;
  }, [vaRows]);
  const visibleCards = useMemo(
    () => CARDS.filter((card) => {
      if (card.type === 'virtual_account') {
        return existingVa.has(card.code) || supportedVaCurrencies.has(card.code);
      }
      return existingStable.has(card.code);
    }),
    [existingStable, existingVa, supportedVaCurrencies],
  );

  const requestVirtualAccount = async (currency: string) => {
    if (requesting) return;
    setErrorMessage('');
    setRequesting(currency);
    try {
      const res: any = await backendAPI.wallets.createVirtualAccount(userId, currency);
      if (!res?.success) {
        setErrorMessage(String(res?.error || 'Account request failed. Please try again.'));
        return;
      }
      await refresh();
    } catch (e) {
      setErrorMessage((e as Error)?.message || 'Account request failed. Please try again.');
    } finally {
      setRequesting(null);
    }
  };

  const renderAction = (card: WalletCard) => {
    const alreadyExists = card.type === 'virtual_account'
      ? existingVa.has(card.code)
      : existingStable.has(card.code);
    if (card.type === 'virtual_account' && !alreadyExists && supportedVaCurrencies.has(card.code)) {
      return (
        <button
          onClick={() => void requestVirtualAccount(card.code)}
          disabled={requesting === card.code}
          className="h-10 px-4 rounded-xl bg-[#C7FF00] text-black text-sm font-semibold disabled:opacity-60"
        >
          {requesting === card.code ? 'Requesting' : 'Request'}
        </button>
      );
    }
    if (alreadyExists) {
      const vaStatus = card.type === 'virtual_account' ? getVaStatus(vaByCurrency.get(card.code)) : 'active';
      const inactive = card.type === 'virtual_account' && INACTIVE_VA_STATUSES.has(vaStatus);
      const active = card.type !== 'virtual_account' || ACTIVE_VA_STATUSES.has(vaStatus);
      return (
        <button
          disabled
          className={`h-10 px-4 rounded-xl text-sm font-semibold ${
            inactive
              ? 'border border-amber-400/30 text-amber-300 bg-amber-400/10'
              : active
                ? 'bg-[#C7FF00] text-black'
                : 'border border-white/15 text-white/70 bg-white/5'
          }`}
        >
          {inactive ? vaStatus : active ? 'Active' : 'Pending'}
        </button>
      );
    }

    return (
      <button disabled className="h-10 px-4 rounded-xl border border-white/15 text-white/55 text-sm font-semibold">
        Not granted
      </button>
    );
  };

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <FloatingBackButton onBack={onBack} />
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-floating-back pb-28">
        <div className="mb-4">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>
            {tt('wallet.add.title', 'Add wallet')}
          </p>
          <h1 className={`text-lg font-semibold ${tc.text} mt-1`}>Available wallets</h1>
          <p className={`text-xs ${tc.textMuted} mt-1`}>
            Accounts loaded from your BorderPay profile. Unsupported rails stay hidden.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {errorMessage}
          </div>
        )}

        <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
          {!initialRefreshDone ? (
            <div className="px-4 py-4">
              <SkeletonRows count={5} />
            </div>
          ) : visibleCards.length === 0 ? (
            <div className="px-4 py-6">
              <p className={`text-sm font-medium ${tc.text}`}>No wallets available</p>
              <p className={`text-xs ${tc.textMuted} mt-1`}>
                Available accounts are loaded from your approved provider profile.
              </p>
            </div>
          ) : visibleCards.map((card, idx) => {
              const displayAsLocal = card.code === 'USDC' && !!localRail;
              const displayCode = displayAsLocal ? localRail.currency : card.code;
              const displayTitle = displayAsLocal ? localRail.country : card.title;
              const displaySubtitle = displayAsLocal ? 'Backed by USDC' : card.subtitle;
              const exists = card.type === 'virtual_account'
                ? existingVa.has(card.code)
                : existingStable.has(card.code);
              const vaStatus = card.type === 'virtual_account' ? getVaStatus(vaByCurrency.get(card.code)) : 'active';
              const inactive = card.type === 'virtual_account' && INACTIVE_VA_STATUSES.has(vaStatus);
              const active = card.type !== 'virtual_account' || ACTIVE_VA_STATUSES.has(vaStatus);
              return (
                <div
                  key={card.code}
                  className={`px-4 py-3.5 flex items-center gap-3 ${idx > 0 ? `border-t ${tc.borderLight}` : ''}`}
                >
                  {card.type === 'stablecoin' && STABLE_ICON_URL[card.code] && !displayAsLocal ? (
                    <div className="w-11 h-11 rounded-full bg-white/10 overflow-hidden flex items-center justify-center">
                      <img
                        src={STABLE_ICON_URL[card.code]}
                        alt={card.code}
                        className="w-8 h-8 object-contain"
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <AssetBadge symbol={displayCode} size={44} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-[15px] font-semibold ${tc.text}`}>{displayCode} <span className={`text-xs font-medium ${tc.textMuted}`}>· {displayTitle}</span></div>
                    <div className={`text-[11px] ${tc.textMuted}`}>
                      {exists ? `${displaySubtitle} · ${inactive ? vaStatus : active ? 'active' : 'pending'}` : `${displaySubtitle} · request available`}
                    </div>
                  </div>
                  {renderAction(card)}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

export default AddWalletScreen;
