import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useThemeClasses, useThemeLanguage } from '../../utils/i18n/ThemeLanguageContext';
import { backendAPI } from '../../utils/api/backendAPI';
import { AssetBadge } from '../dashboard/bridge/WalletVisuals';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { financialCacheKey } from '../../utils/financial/cacheScope';

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
  const refreshInFlightRef = useRef(false);

  const refresh = async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const route: any = await backendAPI.financial.getWalletRouteData();
      const routeData = route?.data || {};
      const nextStable = Array.isArray(routeData?.stablecoin_wallets) ? routeData.stablecoin_wallets : [];
      const nextVa = Array.isArray(routeData?.virtual_accounts) ? routeData.virtual_accounts : [];
      const wallets = Array.isArray(routeData?.wallets) ? routeData.wallets : [];
      setStableRows(nextStable);
      setVaRows(nextVa);
      try { localStorage.setItem(walletCacheKey, JSON.stringify(nextStable)); } catch { /* noop */ }
      try { localStorage.setItem(vaCacheKey, JSON.stringify(nextVa)); } catch { /* noop */ }

      const total = wallets
        .filter((row: any) => ['USDC', 'USDT'].includes(String(row?.currency || '').toUpperCase()))
        .reduce((sum: number, row: any) => sum + Number(row?.balance || 0), 0);
      try { localStorage.setItem(`borderpay_wallet_total_v2_${userId}`, String(total)); } catch { /* noop */ }
    } finally {
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
      if (currency && !map.has(currency)) map.set(currency, row);
    }
    return map;
  }, [vaRows]);
  const visibleCards = useMemo(
    () => CARDS.filter((card) => {
      if (card.type === 'virtual_account') {
        return existingVa.has(card.code);
      }
      return existingStable.has(card.code);
    }),
    [existingStable, existingVa],
  );

  const renderAction = (card: WalletCard) => {
    const alreadyExists = card.type === 'virtual_account'
      ? existingVa.has(card.code)
      : existingStable.has(card.code);
    if (alreadyExists) {
      const vaStatus = card.type === 'virtual_account' ? getVaStatus(vaByCurrency.get(card.code)) : 'active';
      const inactive = card.type === 'virtual_account' && INACTIVE_VA_STATUSES.has(vaStatus);
      return (
        <button
          disabled
          className={`h-10 px-4 rounded-xl text-sm font-semibold ${inactive ? 'border border-amber-400/30 text-amber-300 bg-amber-400/10' : 'bg-[#C7FF00] text-black'}`}
        >
          {inactive ? vaStatus : 'Active'}
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
            Accounts loaded from your Bridge profile. Unsupported rails stay hidden.
          </p>
        </div>

        <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
          {visibleCards.length === 0 ? (
            <div className="px-4 py-6">
              <p className={`text-sm font-medium ${tc.text}`}>No wallets available</p>
              <p className={`text-xs ${tc.textMuted} mt-1`}>
                Available accounts are loaded from your approved provider profile.
              </p>
            </div>
          ) : visibleCards.map((card, idx) => {
              const exists = card.type === 'virtual_account'
                ? existingVa.has(card.code)
                : existingStable.has(card.code);
              const vaStatus = card.type === 'virtual_account' ? getVaStatus(vaByCurrency.get(card.code)) : 'active';
              const inactive = card.type === 'virtual_account' && INACTIVE_VA_STATUSES.has(vaStatus);
              return (
                <div
                  key={card.code}
                  className={`px-4 py-3.5 flex items-center gap-3 ${idx > 0 ? `border-t ${tc.borderLight}` : ''}`}
                >
                  {card.type === 'stablecoin' && STABLE_ICON_URL[card.code] ? (
                    <div className="w-11 h-11 rounded-full bg-white/10 overflow-hidden flex items-center justify-center">
                      <img
                        src={STABLE_ICON_URL[card.code]}
                        alt={card.code}
                        className="w-8 h-8 object-contain"
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <AssetBadge symbol={card.code} size={44} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-[15px] font-semibold ${tc.text}`}>{card.title}</div>
                    <div className={`text-[11px] ${tc.textMuted}`}>
                      {exists ? `${card.subtitle} · ${inactive ? vaStatus : 'active'}` : `${card.subtitle} · not granted`}
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
