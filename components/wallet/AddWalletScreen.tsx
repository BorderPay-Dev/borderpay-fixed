import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Plus, Shield } from 'lucide-react';
import { useThemeClasses, useThemeLanguage } from '../../utils/i18n/ThemeLanguageContext';
import { backendAPI } from '../../utils/api/backendAPI';
import {
  type BridgeVirtualAccountCurrency,
} from '../../utils/compliance/partnerCountryPolicy';
import { AssetBadge } from '../dashboard/bridge/WalletVisuals';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { showToast } from '../common/StatusToast';
import { friendlyError } from '../../utils/errors/friendlyError';
import { financialCacheKey } from '../../utils/financial/cacheScope';

interface AddWalletScreenProps {
  userId: string;
  onBack: () => void;
}

interface StableRow { id: string; currency: string }
interface VaRow { id: string; currency: BridgeVirtualAccountCurrency }

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

const STABLE_CHAIN: Record<string, string> = {
  USDC: 'BASE',
  USDT: 'TRON',
};

const STABLE_ICON_URL: Record<string, string> = {
  USDC: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/usdc.png',
  USDT: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/usdt.png',
};

function isApproved(value?: string | null): boolean {
  if (typeof value !== 'string') return false;
  return ['approved', 'active', 'authorized', 'verified', 'completed', 'complete'].includes(value.toLowerCase());
}

export function AddWalletScreen({ userId, onBack }: AddWalletScreenProps) {
  const tc = useThemeClasses();
  const { t } = useThemeLanguage();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const [supportedVaCurrencies, setSupportedVaCurrencies] = useState<BridgeVirtualAccountCurrency[]>([]);
  const [stableSupported, setStableSupported] = useState<boolean>(false);

  const [verified, setVerified] = useState<boolean>(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
      const accountType = String(cached?.account_type || 'individual').toLowerCase();
      return accountType === 'business'
        ? (isApproved(cached?.bridge_kyb_status) || isApproved(cached?.bridge_kyc_status) || isApproved(cached?.bridge_account_status))
        : (isApproved(cached?.bridge_kyc_status) || isApproved(cached?.bridge_account_status));
    } catch {
      return false;
    }
  });

  const [hasFirstFunding, setHasFirstFunding] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(`borderpay_wallet_total_${userId}`);
      return Number(raw || 0) > 0;
    } catch {
      return false;
    }
  });

  const walletCacheKey = useMemo(
    () => financialCacheKey('borderpay_wallets_v1', { userId }),
    [userId],
  );
  const vaCacheKey = useMemo(
    () => financialCacheKey('borderpay_va_v1', { userId }),
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
  const [creating, setCreating] = useState<string | null>(null);
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

      const total = wallets.reduce((sum: number, row: any) => sum + Number(row?.balance || 0), 0);
      setHasFirstFunding(total > 0);
      try { localStorage.setItem(`borderpay_wallet_total_${userId}`, String(total)); } catch { /* noop */ }

      try {
        const [vaCaps, walletCaps] = await Promise.all([
          backendAPI.bridge.virtualAccount.capabilities(),
          backendAPI.bridge.wallet.capabilities(),
        ]);
        if (vaCaps?.success && Array.isArray(vaCaps?.data?.supported_currencies)) {
          const next = vaCaps.data.supported_currencies
            .filter((c: unknown): c is BridgeVirtualAccountCurrency => ['USD', 'EUR', 'GBP'].includes(String(c).toUpperCase()))
            .map((c: string) => c.toUpperCase() as BridgeVirtualAccountCurrency);
          setSupportedVaCurrencies(next);
        } else {
          setSupportedVaCurrencies([]);
        }
        if (walletCaps?.success) {
          setStableSupported(Boolean(walletCaps?.data?.supported));
        } else {
          setStableSupported(false);
        }
      } catch {
        // Fail-closed on capabilities fetch errors.
        setSupportedVaCurrencies([]);
        setStableSupported(false);
      }

      const p = await backendAPI.user.getProfile();
      if (p?.success && p?.data?.user) {
        const u = p.data.user;
        const accountType = String(u?.account_type || 'individual').toLowerCase();
        const isVerified = accountType === 'business'
          ? (isApproved(u?.bridge_kyb_status) || isApproved(u?.bridge_kyc_status) || isApproved(u?.bridge_account_status))
          : (isApproved(u?.bridge_kyc_status) || isApproved(u?.bridge_account_status));
        setVerified(isVerified);
      }
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

  const requestWallet = async (card: WalletCard) => {
    if (creating) return;
    setCreating(card.code);
    try {
      if (card.type === 'virtual_account') {
        const res: any = await backendAPI.bridge.virtualAccount.create({
          currency: card.code as BridgeVirtualAccountCurrency,
        });
        if (!res?.success) {
          const msg = friendlyError(
            res?.error,
            card.code === 'GBP'
              ? 'GBP account is not available for your region yet. Contact support to enable it.'
              : `Could not activate ${card.code} account.`,
          );
          showToast.error(msg);
          return;
        }
        showToast.success(`${card.code} account activated`);
      } else {
        const chain = STABLE_CHAIN[card.code] || 'BASE';
        const res: any = await backendAPI.bridge.wallet.create({ symbol: card.code, chain });
        if (!res?.success) {
          showToast.error(friendlyError(res?.error, `Could not add ${card.code} wallet.`));
          return;
        }
        showToast.success(`${card.code} wallet added`);
      }
      await refresh();
    } finally {
      setCreating(null);
    }
  };

  const renderAction = (card: WalletCard) => {
    const alreadyExists = card.type === 'virtual_account'
      ? existingVa.has(card.code)
      : existingStable.has(card.code);
    if (alreadyExists) {
      return (
        <button
          disabled
          className="h-10 px-4 rounded-xl bg-[#C7FF00] text-black text-sm font-semibold"
        >
          Active
        </button>
      );
    }

    const supported = card.type === 'virtual_account'
      ? supportedVaCurrencies.includes(card.code as BridgeVirtualAccountCurrency)
      : stableSupported;

    if (!supported) {
      return (
        <button
          disabled
          className="h-10 px-4 rounded-xl border border-white/15 text-white/55 text-sm font-semibold"
        >
          Unavailable
        </button>
      );
    }

    if (!verified) {
      return (
        <button
          disabled
          className="h-10 px-4 rounded-xl border border-white/15 text-white/55 text-sm font-semibold"
        >
          Verify first
        </button>
      );
    }

    if (card.type === 'virtual_account' && !hasFirstFunding) {
      return (
        <button
          disabled
          className="h-10 px-4 rounded-xl border border-white/15 text-white/55 text-sm font-semibold"
          title="Receive your first transfer to unlock virtual accounts."
        >
          Locked
        </button>
      );
    }

    return (
      <button
        onClick={() => void requestWallet(card)}
        disabled={creating === card.code}
        className="h-10 px-4 rounded-xl bg-[#C7FF00] text-black text-sm font-semibold disabled:opacity-60"
      >
        {creating === card.code ? 'Adding…' : 'Add'}
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
            Add only what you need. Unsupported wallets stay locked for your region.
          </p>
        </div>

        {!hasFirstFunding && (
          <div className={`mb-4 rounded-2xl border ${tc.cardBorder} ${tc.card} p-3 flex items-start gap-2`}>
            <Shield className="w-4 h-4 text-[#C7FF00] mt-0.5 flex-shrink-0" />
            <p className={`text-xs ${tc.textSecondary}`}>
              Receive your first transfer to unlock virtual accounts (USD, EUR, GBP).
              Stablecoin wallets can be added now.
            </p>
          </div>
        )}

        <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
          {CARDS.map((card, idx) => {
              const exists = card.type === 'virtual_account'
                ? existingVa.has(card.code)
                : existingStable.has(card.code);
              const supported = card.type === 'virtual_account'
                ? supportedVaCurrencies.includes(card.code as BridgeVirtualAccountCurrency)
                : stableSupported;
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
                      {!supported
                        ? `${card.subtitle} · not available in your region`
                        : exists
                          ? `${card.subtitle} · active`
                          : card.subtitle}
                    </div>
                  </div>
                  {!supported && <Lock className="w-4 h-4 text-white/45 mr-1" />}
                  {!exists && supported && <Plus className="w-4 h-4 text-white/45 mr-1" />}
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
