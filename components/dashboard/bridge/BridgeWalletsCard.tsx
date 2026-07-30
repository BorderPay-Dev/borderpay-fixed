/**
 * BridgeWalletsCard — list + create custodial stablecoin wallets.
 *
 * Reads public.bridge_wallets for this user (or business) and shows
 * deposit address + chain. Provides a single Create button for the default
 * stablecoin (USDC on Base). Other stablecoin/chain pairs can be added
 * later under explicit product rollout.
 */

import React, { useEffect, useState } from 'react';
import { friendlyError } from '../../../utils/errors/friendlyError';
import { motion } from 'motion/react';
import { Wallet, Plus, Loader2, Lock, ChevronRight } from 'lucide-react';
import { Skeleton } from '../../common/Skeleton';
import { AssetBadge, WalletDetailSheet, chainLabel, assetName } from './WalletVisuals';
import { supabase } from '../../../utils/supabase/client';
import { backendAPI } from '../../../utils/api/backendAPI';
import { authAPI } from '../../../utils/supabase/client';
import { isBridgeCustodialWalletSupported } from '../../../utils/compliance/partnerCountryPolicy';
import { useThemeLanguage, useThemeClasses } from '../../../utils/i18n/ThemeLanguageContext';
import { showToast } from '../../common/StatusToast';
import { financialCacheKey } from '../../../utils/financial/cacheScope';

interface WalletRow {
  id:                 string;
  bridge_wallet_id:   string;
  currency:           string;
  chain:              string;
  address:            string;
  status:             string;
}

interface Props {
  userId:        string;
  kycApproved?:  boolean;
  isBusiness?:   boolean;
}

const DEFAULT_STABLECOIN = { symbol: 'usdc', chain: 'base', label: 'USDC on Base' };

export function BridgeWalletsCard({ userId, kycApproved, isBusiness = false }: Props) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const walletCacheKey = React.useMemo(
    () => financialCacheKey('borderpay_wallets_card_v1', { userId, accountType: isBusiness ? 'business' : 'individual' }),
    [userId, isBusiness],
  );
  const cachedRows = React.useMemo<WalletRow[]>(() => {
    try { const raw = localStorage.getItem(walletCacheKey); return raw ? JSON.parse(raw) : []; }
    catch { return []; }
  }, [walletCacheKey]);
  const [rows, setRows]       = useState<WalletRow[]>(cachedRows);
  const [loading, setLoading] = useState(cachedRows.length === 0);
  const [creating, setCreating] = useState(false);
  const [derivedApproved, setDerivedApproved] = useState(false);
  const [country, setCountry] = useState<string | null>(() => authAPI.getStoredUser()?.country ?? null);
  const [selected, setSelected] = useState<WalletRow | null>(null);

  const isApproved = kycApproved ?? derivedApproved;
  const walletsSupported = isBridgeCustodialWalletSupported(country);

  const refresh = async () => {
    const loadLocal = async () => {
      const q = supabase.from('bridge_wallets').select('*').order('created_at', { ascending: false });
      const { data } = isBusiness
        ? await q.eq('business_user_id', userId)
        : await q.eq('user_id', userId);
      const next = (data as WalletRow[]) ?? [];
      setRows(next);
      try { localStorage.setItem(walletCacheKey, JSON.stringify(next)); } catch { /* noop */ }
      setLoading(false);
    };

    await loadLocal();
    // Stablecoin provisioning/reconciliation is background-only. Verified users
    // should see cached/local rows instantly while Bridge catches up.
    void backendAPI.bridge.provisionStablecoins()
      .catch(() => null)
      .then(() => backendAPI.bridge.syncAccounts())
      .then(loadLocal)
      .catch(() => null);
  };

  useEffect(() => { refresh(); }, [userId, isBusiness]);

  useEffect(() => {
    if (kycApproved !== undefined) return;
    let alive = true;
    (async () => {
      if (isBusiness) {
        const { data } = await supabase
          .from('business_profiles')
          .select('bridge_kyb_status, country')
          .eq('user_id', userId)
          .maybeSingle();
        if (alive) {
          setDerivedApproved(data?.bridge_kyb_status === 'approved');
          setCountry(data?.country ?? authAPI.getStoredUser()?.country ?? null);
        }
      } else {
        const { data } = await supabase
          .from('user_profiles')
          .select('bridge_kyc_status, country')
          .eq('id', userId)
          .maybeSingle();
        if (alive) {
          setDerivedApproved(data?.bridge_kyc_status === 'approved');
          setCountry(data?.country ?? authAPI.getStoredUser()?.country ?? null);
        }
      }
    })();
    return () => { alive = false; };
  }, [userId, isBusiness, kycApproved]);

  const handleCreate = async () => {
    if (!walletsSupported) {
      showToast.error('Digital dollar wallets are not available for your country.');
      return;
    }
    setCreating(true);
    const r = await backendAPI.bridge.wallet.create({ symbol: DEFAULT_STABLECOIN.symbol, chain: DEFAULT_STABLECOIN.chain });
    setCreating(false);
    if (!r.success) {
      showToast.error(friendlyError(r.error, tt('dash.wallet.create.failed', 'Could not create wallet.')));
      return;
    }
    showToast.success(tt('dash.wallet.create.success', `${DEFAULT_STABLECOIN.label} wallet created`));
    refresh();
  };

  const hasDefault = rows.some(r => r.currency.toLowerCase() === DEFAULT_STABLECOIN.symbol && r.chain.toLowerCase() === DEFAULT_STABLECOIN.chain);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-5 sm:p-6`}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-2xl bg-[#C7FF00]/20 flex items-center justify-center">
          <Wallet className="w-5 h-5 text-black dark:text-white" />
        </div>
        <div className="flex-1">
          <h3 className={`text-base font-semibold ${tc.text}`}>
            {tt('dash.wallet.title', 'Digital dollar wallets')}
          </h3>
          <p className={`text-xs ${tc.textMuted}`}>
            {walletsSupported
              ? tt('dash.wallet.subtitle', 'USDC and USDT digital dollar wallets.')
              : tt('dash.wallet.subtitle.unavailable', 'Digital dollar wallets are not available for your country.')}
          </p>
        </div>
      </div>

      {!isApproved && (
        <div className={`flex items-center gap-2 p-3 rounded-2xl ${tc.bgAlt} border ${tc.border} mb-3`}>
          <Lock className={`w-4 h-4 ${tc.textMuted}`} />
          <p className={`text-xs ${tc.textMuted}`}>
            {tt('dash.wallet.locked', 'Verify your identity to enable wallets.')}
          </p>
        </div>
      )}

      {country && !walletsSupported && (
        <div className={`flex items-center gap-2 p-3 rounded-2xl ${tc.bgAlt} border ${tc.border} mb-3`}>
          <Lock className={`w-4 h-4 ${tc.textMuted}`} />
          <p className={`text-xs ${tc.textMuted}`}>
            Digital dollar wallets are not currently available for your country.
          </p>
        </div>
      )}

      {loading ? (
        <div className="space-y-2 mb-3">
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          {rows.length > 0 && (
            <ul className="space-y-2 mb-3">
              {rows.map(r => {
                const sym = r.currency.toUpperCase();
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => setSelected(r)}
                      className={`w-full flex items-center gap-3 p-3 rounded-2xl ${tc.bgAlt} border ${tc.border} ${tc.hoverBg} transition`}
                    >
                      <AssetBadge symbol={sym} size={40} />
                      <div className="flex-1 min-w-0 text-left">
                        <div className={`text-sm font-semibold ${tc.text}`}>{sym}</div>
                        <div className={`text-xs ${tc.textMuted} truncate`}>{assetName(sym)} · {chainLabel(r.chain)}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-bold ${tc.text}`} style={{ fontVariantNumeric: 'tabular-nums' }}>$0.00</div>
                        <div className={`text-[11px] ${tc.textMuted}`} style={{ fontVariantNumeric: 'tabular-nums' }}>0.00 {sym}</div>
                      </div>
                      <ChevronRight className={`w-4 h-4 ${tc.textMuted} flex-shrink-0`} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!hasDefault && (
            <button
              disabled={!isApproved || !walletsSupported || creating}
              onClick={handleCreate}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition
                ${isApproved && walletsSupported
                  ? 'bg-[#C7FF00] text-black hover:opacity-90'
                  : `${tc.bgAlt} ${tc.textMuted} cursor-not-allowed`}`}
            >
              {creating
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Plus className="w-3.5 h-3.5" />}
              {tt('dash.wallet.add', 'Add')} {DEFAULT_STABLECOIN.label}
            </button>
          )}
        </>
      )}

      <WalletDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        wallet={selected ? { currency: selected.currency, chain: selected.chain, address: selected.address } : null}
      />
    </motion.div>
  );
}

export default BridgeWalletsCard;
