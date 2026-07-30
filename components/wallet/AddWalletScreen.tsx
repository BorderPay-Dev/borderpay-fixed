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
import { virtualAccountActivationMessage } from '../../utils/virtualAccountActivationCopy';

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
  { code: 'USDC', type: 'stablecoin', title: 'USD Coin', subtitle: 'Digital dollar wallet' },
  { code: 'USDT', type: 'stablecoin', title: 'Tether USD', subtitle: 'Digital dollar wallet' },
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

function normalizedCountry(value: unknown): string | null {
  const s = String(value || '').trim().toUpperCase();
  return s || null;
}

function countryAllowedVaCurrencies(country: string | null | undefined): BridgeVirtualAccountCurrency[] {
  return bridgeVirtualAccountCurrenciesForCountry(country);
}

export function AddWalletScreen({ userId, onBack }: AddWalletScreenProps) {
  const tc = useThemeClasses();
  const { t } = useThemeLanguage();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const [country, setCountry] = useState<string | null>(() => {
    const cached = readCachedUser();
    return cached?.country ? String(cached.country).toUpperCase() : null;
  });
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
  const [creatingGlobalAccounts, setCreatingGlobalAccounts] = useState(false);
  const [configuredVaCurrencies, setConfiguredVaCurrencies] = useState<BridgeVirtualAccountCurrency[] | null>(null);
  const [setupPendingVaCurrencies, setSetupPendingVaCurrencies] = useState<BridgeVirtualAccountCurrency[]>([]);
  const [supportRequiredVaCurrencies, setSupportRequiredVaCurrencies] = useState<BridgeVirtualAccountCurrency[]>([]);
  const refreshInFlightRef = useRef(false);

  const refresh = async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const route: any = await backendAPI.financial.getWalletRouteData();
      const routeData = route?.data || {};
      const nextStable = Array.isArray(routeData?.stablecoin_wallets) ? routeData.stablecoin_wallets : [];
      const nextVa = Array.isArray(routeData?.virtual_accounts) ? routeData.virtual_accounts : [];
      const vaCaps = routeData?.virtual_account_capabilities || null;
      setStableRows(nextStable);
      setVaRows(nextVa);
      if (vaCaps) {
        const operational = Array.isArray(vaCaps?.operational_currencies)
          ? vaCaps.operational_currencies
          : Array.isArray(vaCaps?.configured_currencies)
            ? vaCaps.configured_currencies
            : null;
        const pending = Array.isArray(vaCaps?.setup_pending_currencies)
          ? vaCaps.setup_pending_currencies
          : [];
        const providerPending = Array.isArray(vaCaps?.provider_pending_currencies)
          ? vaCaps.provider_pending_currencies
          : [];
        setConfiguredVaCurrencies(
          operational
            ? operational.filter((c: unknown): c is BridgeVirtualAccountCurrency => ['USD', 'EUR', 'GBP'].includes(String(c)))
            : null,
        );
        setSetupPendingVaCurrencies(
          pending.filter((c: unknown): c is BridgeVirtualAccountCurrency => ['USD', 'EUR', 'GBP'].includes(String(c))),
        );
        setSupportRequiredVaCurrencies(
          providerPending.filter((c: unknown): c is BridgeVirtualAccountCurrency => ['USD', 'EUR', 'GBP'].includes(String(c))),
        );
      }
      try { localStorage.setItem(walletCacheKey, JSON.stringify(nextStable)); } catch { /* noop */ }
      try { localStorage.setItem(vaCacheKey, JSON.stringify(nextVa)); } catch { /* noop */ }

      try {
        const p = await backendAPI.user.getProfile();
        if (p?.success && p?.data?.user) {
          const u = p.data.user;
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
              // Keep the user profile payload if the business profile refresh fails.
            }
          }
          setCountry(profileCountry);
          setVerified(isVerifiedProfile(hydrated));
          try { localStorage.setItem('borderpay_user', JSON.stringify({ ...hydrated, country: profileCountry ?? hydrated.country })); } catch { /* noop */ }
        }
      } catch {
        // Keep cached identity state.
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
  const supportedVaCurrencies = useMemo(
    () => countryAllowedVaCurrencies(country),
    [country],
  );
  const operationalVaCurrencies = useMemo(
    () => configuredVaCurrencies ?? supportedVaCurrencies,
    [configuredVaCurrencies, supportedVaCurrencies],
  );
  const stableSupported = useMemo(
    () => isBridgeCustodialWalletSupported(country),
    [country],
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
          const mapped = virtualAccountActivationMessage(res, card.code);
          showToast[mapped.type]({ title: mapped.title, message: mapped.message, duration: 6000 });
          if (mapped.type === 'info') await refresh();
          return;
        }
        showToast.success(`${card.code} account ready`);
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

  const missingGlobalAccounts = useMemo(
    () => operationalVaCurrencies.filter((currency) => !activeVa.has(currency) && !inactiveVa.has(currency)),
    [activeVa, inactiveVa, operationalVaCurrencies],
  );

  const requestAllGlobalAccounts = async () => {
    if (!verified || creatingGlobalAccounts || missingGlobalAccounts.length === 0) return;
    setCreatingGlobalAccounts(true);
    let created = 0;
    let pending = 0;
    let failed = 0;
    try {
      for (const currency of missingGlobalAccounts) {
        const res: any = await backendAPI.bridge.virtualAccount.create({ currency });
        if (res?.success) {
          created += 1;
          continue;
        }
        const mapped = virtualAccountActivationMessage(res, currency);
        if (mapped.type === 'info') pending += 1;
        else failed += 1;
      }
      await refresh();
      if (created > 0) showToast.success(`${created} global account${created === 1 ? '' : 's'} ready`);
      if (pending > 0) {
        showToast.info({
          title: 'Some accounts are being prepared',
          message: 'We will notify you when the remaining account details are ready.',
          duration: 6000,
        });
      }
      if (failed > 0 && created === 0 && pending === 0) {
        showToast.error('Could not activate global accounts right now. Please try again.');
      }
    } finally {
      setCreatingGlobalAccounts(false);
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
      : stableSupported;
    const setupPending = card.type === 'virtual_account' &&
      setupPendingVaCurrencies.includes(card.code as BridgeVirtualAccountCurrency);
    const supportRequired = card.type === 'virtual_account' &&
      supportRequiredVaCurrencies.includes(card.code as BridgeVirtualAccountCurrency);

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
    if (setupPending && !supportRequired) {
      return (
        <button
          disabled
          className="h-10 px-4 rounded-xl border border-amber-400/30 text-amber-200/80 text-sm font-semibold"
        >
          Preparing
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
        disabled={creatingGlobalAccounts || creating === card.code}
        title={supportRequired ? `Contact support to activate ${card.code} receiving. Try again after support confirms it is enabled.` : undefined}
        className={`h-10 px-4 rounded-xl text-sm font-semibold disabled:opacity-60 ${
          supportRequired
            ? 'border border-amber-400/30 text-amber-200/90'
            : 'bg-[#C7FF00] text-black'
        }`}
      >
        {creating === card.code ? 'Adding…' : supportRequired ? 'Try again' : (card.type === 'virtual_account' ? 'Activate' : 'Add')}
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

        {missingGlobalAccounts.length > 1 && (
          <button
            type="button"
            onClick={requestAllGlobalAccounts}
            disabled={!verified || creatingGlobalAccounts}
            className="mb-4 w-full rounded-2xl bg-[#C7FF00] px-4 py-3.5 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creatingGlobalAccounts ? 'Activating global accounts...' : `Activate ${missingGlobalAccounts.join(', ')} accounts`}
          </button>
        )}

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
                : stableSupported;
              const setupPending = card.type === 'virtual_account' &&
                setupPendingVaCurrencies.includes(card.code as BridgeVirtualAccountCurrency);
              const supportRequired = card.type === 'virtual_account' &&
                supportRequiredVaCurrencies.includes(card.code as BridgeVirtualAccountCurrency);
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
                            : supportRequired
                              ? `${card.subtitle} · contact support to activate`
                            : setupPending
                              ? `${card.subtitle} · being enabled`
                            : card.subtitle}
                    </div>
                  </div>
                  {!supported && !deactivated && <Lock className="w-4 h-4 text-white/45 mr-1" />}
                  {!active && !deactivated && supported && (!setupPending || supportRequired) && <Plus className="w-4 h-4 text-white/45 mr-1" />}
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
