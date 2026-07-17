import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Plus } from 'lucide-react';
import { useThemeClasses, useThemeLanguage } from '../../utils/i18n/ThemeLanguageContext';
import { backendAPI } from '../../utils/api/backendAPI';
import {
  bridgeVirtualAccountCurrenciesForCountry,
  isBridgeCustodialWalletSupported,
  type BridgeVirtualAccountCurrency,
} from '../../utils/compliance/partnerCountryPolicy';
import { deriveKycStatus } from '../../utils/config/environment';
import { AssetBadge } from '../dashboard/bridge/WalletVisuals';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { showToast } from '../common/StatusToast';
import { friendlyError } from '../../utils/errors/friendlyError';
import { financialCacheKey } from '../../utils/financial/cacheScope';

interface AddWalletScreenProps {
  userId: string;
  onBack: () => void;
}

interface StableRow { id: string; currency: string; status?: string }
interface VaRow { id: string; currency: BridgeVirtualAccountCurrency; status?: string }

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
const ACTIVE_ROW_STATUSES = new Set(['active', 'approved', 'enabled', 'ready', 'provisioned']);

function isActiveRow(row: { status?: string }): boolean {
  return ACTIVE_ROW_STATUSES.has(String(row.status || '').trim().toLowerCase());
}

function readCachedUser(): any {
  try {
    return JSON.parse(localStorage.getItem('borderpay_user') || '{}');
  } catch {
    return {};
  }
}

function isVerifiedProfile(profile: any): boolean {
  return deriveKycStatus(profile) === 'verified';
}

function countryAllowedVaCurrencies(country: string | null | undefined): BridgeVirtualAccountCurrency[] {
  return bridgeVirtualAccountCurrenciesForCountry(country);
}

function intersectVaCapabilities(
  supported: unknown,
  country: string | null | undefined,
): BridgeVirtualAccountCurrency[] {
  const countryAllowed = countryAllowedVaCurrencies(country);
  if (!Array.isArray(supported)) return countryAllowed;
  const globalSupported = supported
    .map((c: unknown) => String(c || '').toUpperCase())
    .filter((c: string): c is BridgeVirtualAccountCurrency => ['USD', 'EUR', 'GBP'].includes(c));
  return countryAllowed.filter((c) => globalSupported.includes(c));
}

export function AddWalletScreen({ userId, onBack }: AddWalletScreenProps) {
  const tc = useThemeClasses();
  const { t } = useThemeLanguage();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const [country, setCountry] = useState<string | null>(() => {
    const cached = readCachedUser();
    return cached?.country ? String(cached.country).toUpperCase() : null;
  });
  const [supportedVaCurrencies, setSupportedVaCurrencies] = useState<BridgeVirtualAccountCurrency[]>(
    () => countryAllowedVaCurrencies(readCachedUser()?.country ? String(readCachedUser().country).toUpperCase() : null),
  );
  const [stableSupported, setStableSupported] = useState<boolean>(
    () => isBridgeCustodialWalletSupported(readCachedUser()?.country ? String(readCachedUser().country).toUpperCase() : null),
  );
  const [supportedStableSymbols, setSupportedStableSymbols] = useState<string[]>(['USDC', 'USDT']);

  const [verified, setVerified] = useState<boolean>(() => {
    return isVerifiedProfile(readCachedUser());
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
      setStableRows(nextStable);
      setVaRows(nextVa);
      try { localStorage.setItem(walletCacheKey, JSON.stringify(nextStable)); } catch { /* noop */ }
      try { localStorage.setItem(vaCacheKey, JSON.stringify(nextVa)); } catch { /* noop */ }

      let profileCountry = country;
      try {
        const p = await backendAPI.user.getProfile();
        if (p?.success && p?.data?.user) {
          const u = p.data.user;
          profileCountry = u?.country ? String(u.country).toUpperCase() : null;
          setCountry(profileCountry);
          setVerified(isVerifiedProfile(u));
          try { localStorage.setItem('borderpay_user', JSON.stringify(u)); } catch { /* noop */ }
        }
      } catch {
        // Keep cached identity state.
      }

      try {
        const [vaCaps, walletCaps] = await Promise.all([
          backendAPI.bridge.virtualAccount.capabilities(),
          backendAPI.bridge.wallet.capabilities(),
        ]);
        if (vaCaps?.success && Array.isArray(vaCaps?.data?.supported_currencies)) {
          setSupportedVaCurrencies(intersectVaCapabilities(vaCaps.data.supported_currencies, profileCountry));
        } else {
          setSupportedVaCurrencies(countryAllowedVaCurrencies(profileCountry));
        }
        if (walletCaps?.success) {
          setStableSupported(Boolean(walletCaps?.data?.supported) && isBridgeCustodialWalletSupported(profileCountry));
          if (Array.isArray(walletCaps?.data?.supported_symbols) && walletCaps.data.supported_symbols.length > 0) {
            const supported = walletCaps.data.supported_symbols
              .map((s: any) => String(s || '').toUpperCase())
              .filter((s: string) => s === 'USDC' || s === 'USDT');
            setSupportedStableSymbols(supported);
          } else {
            setSupportedStableSymbols(['USDC', 'USDT']);
          }
        } else {
          setStableSupported(false);
          setSupportedStableSymbols([]);
        }
      } catch {
        // Fail-closed on capabilities fetch errors.
        setSupportedVaCurrencies(countryAllowedVaCurrencies(profileCountry));
        setStableSupported(false);
        setSupportedStableSymbols([]);
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  };

  useEffect(() => {
    void refresh();
  }, [userId]);

  const activeStable = useMemo(
    () => new Set(stableRows.filter(isActiveRow).map((r) => String(r.currency || '').toUpperCase())),
    [stableRows],
  );
  const inactiveStable = useMemo(
    () => new Set(stableRows.filter((r) => !isActiveRow(r)).map((r) => String(r.currency || '').toUpperCase())),
    [stableRows],
  );
  const activeVa = useMemo(
    () => new Set(vaRows.filter(isActiveRow).map((r) => String(r.currency || '').toUpperCase())),
    [vaRows],
  );
  const inactiveVa = useMemo(
    () => new Set(vaRows.filter((r) => !isActiveRow(r)).map((r) => String(r.currency || '').toUpperCase())),
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
          const msg = friendlyError(res?.error, `Could not activate ${card.code} account.`);
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
    const alreadyActive = card.type === 'virtual_account'
      ? activeVa.has(card.code)
      : activeStable.has(card.code);
    const deactivated = card.type === 'virtual_account'
      ? inactiveVa.has(card.code)
      : inactiveStable.has(card.code);
    if (deactivated) {
      return (
        <button
          disabled
          className="h-10 px-4 rounded-xl border border-amber-400/30 text-amber-200/80 text-sm font-semibold"
        >
          Deactivated
        </button>
      );
    }
    if (alreadyActive) {
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
      : (stableSupported && supportedStableSymbols.includes(card.code));

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

    return (
      <button
        onClick={() => void requestWallet(card)}
        disabled={creating === card.code}
        className="h-10 px-4 rounded-xl bg-[#C7FF00] text-black text-sm font-semibold disabled:opacity-60"
      >
        {creating === card.code ? 'Adding…' : (card.type === 'virtual_account' ? 'Activate' : 'Add')}
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

        <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
          {CARDS.map((card, idx) => {
              const active = card.type === 'virtual_account'
                ? activeVa.has(card.code)
                : activeStable.has(card.code);
              const deactivated = card.type === 'virtual_account'
                ? inactiveVa.has(card.code)
                : inactiveStable.has(card.code);
              const supported = card.type === 'virtual_account'
                ? supportedVaCurrencies.includes(card.code as BridgeVirtualAccountCurrency)
                : (stableSupported && supportedStableSymbols.includes(card.code));
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
                      {active
                        ? `${card.subtitle} · active`
                        : deactivated
                          ? `${card.subtitle} · deactivated`
                          : !supported
                            ? `${card.subtitle} · not available in your region`
                            : card.subtitle}
                    </div>
                  </div>
                  {!supported && !deactivated && <Lock className="w-4 h-4 text-white/45 mr-1" />}
                  {!active && !deactivated && supported && <Plus className="w-4 h-4 text-white/45 mr-1" />}
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
