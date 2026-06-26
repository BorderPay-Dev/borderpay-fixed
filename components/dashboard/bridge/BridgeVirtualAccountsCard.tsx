/**
 * BridgeVirtualAccountsCard — list + create USD/EUR/GBP virtual accounts.
 *
 * Lists rows from public.bridge_virtual_accounts for this user (or business
 * profile). For currencies the user does NOT yet have, shows a 'Create'
 * button that calls bridgeAPI.virtualAccount.create.
 *
 * Disabled until KYC/KYB is approved (Bridge requires verified state to
 * issue VAs). Pass `kycApproved` from the parent dashboard.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { friendlyError } from '../../../utils/errors/friendlyError';
import { motion } from 'motion/react';
import { Building2, Plus, Loader2, Lock, ChevronRight } from 'lucide-react';
import { Skeleton } from '../../common/Skeleton';
import { AssetBadge, AccountDetailSheet } from './WalletVisuals';
import { supabase } from '../../../utils/supabase/client';
import { backendAPI } from '../../../utils/api/backendAPI';
import { authAPI } from '../../../utils/supabase/client';
import {
  bridgeVirtualAccountCurrenciesForCountry,
  isBridgeVirtualAccountCurrencyAvailable,
  type BridgeVirtualAccountCurrency,
} from '../../../utils/compliance/partnerCountryPolicy';
import { useThemeLanguage, useThemeClasses } from '../../../utils/i18n/ThemeLanguageContext';
import { showToast } from '../../common/StatusToast';
import { financialCacheKey } from '../../../utils/financial/cacheScope';

type Currency = BridgeVirtualAccountCurrency;

interface VARow {
  id:                          string;
  bridge_virtual_account_id:   string;
  currency:                    Currency;
  rail:                        string | null;
  account_details:             Record<string, any>;
  status:                      string;
}

interface Props {
  userId:        string;
  kycApproved?:  boolean;
  isBusiness?:   boolean;
}

export function BridgeVirtualAccountsCard({ userId, kycApproved, isBusiness = false }: Props) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const vaCacheKey = financialCacheKey('borderpay_va_v1', {
    userId,
    accountType: isBusiness ? 'business' : 'individual',
  });
  const cachedRows = useMemo<VARow[]>(() => {
    try { const raw = localStorage.getItem(vaCacheKey); return raw ? JSON.parse(raw) : []; }
    catch { return []; }
  }, [vaCacheKey]);
  const [rows, setRows]       = useState<VARow[]>(cachedRows);
  const [loading, setLoading] = useState(cachedRows.length === 0);
  const [creating, setCreating] = useState<Currency | null>(null);
  const [derivedApproved, setDerivedApproved] = useState(false);
  const [country, setCountry] = useState<string | null>(() => authAPI.getStoredUser()?.country ?? null);
  const [selected, setSelected] = useState<VARow | null>(null);

  const isApproved = kycApproved ?? derivedApproved;
  const availableCurrencies = useMemo(
    () => bridgeVirtualAccountCurrenciesForCountry(country),
    [country],
  );

  const refresh = async (forceSync = false) => {
    const q = supabase.from('bridge_virtual_accounts').select('*').order('created_at', { ascending: false });
    const { data } = isBusiness
      ? await q.eq('business_user_id', userId)
      : await q.eq('user_id', userId);
    const next = (data as VARow[]) ?? [];
    setRows(next);
    try { localStorage.setItem(vaCacheKey, JSON.stringify(next)); } catch { /* noop */ }
    setLoading(false);

    // Keep first paint local-first. Mirror Bridge → local in background, then
    // re-read rows once sync completes so newly provisioned accounts appear.
    if (forceSync || next.length === 0) {
      try {
        await backendAPI.bridge.syncAccounts();
        const q2 = supabase.from('bridge_virtual_accounts').select('*').order('created_at', { ascending: false });
        const { data: synced } = isBusiness
          ? await q2.eq('business_user_id', userId)
          : await q2.eq('user_id', userId);
        const merged = (synced as VARow[]) ?? [];
        setRows(merged);
        try { localStorage.setItem(vaCacheKey, JSON.stringify(merged)); } catch { /* noop */ }
      } catch { /* best-effort */ }
    }
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

  const haveCurrencies = useMemo(() => new Set(rows.map(r => r.currency)), [rows]);
  const missingCurrencies = availableCurrencies.filter(c => !haveCurrencies.has(c));

  const handleCreate = async (currency: Currency) => {
    if (!isBridgeVirtualAccountCurrencyAvailable(country, currency)) {
      showToast.error(`${currency} virtual accounts are not available for your country.`);
      return;
    }
    setCreating(currency);
    const r = await backendAPI.bridge.virtualAccount.create({ currency });
    setCreating(null);
    if (!r.success) {
      showToast.error(friendlyError(r.error, tt('dash.va.create.failed', 'Could not create the virtual account.')));
      return;
    }
    showToast.success(tt('dash.va.create.success', `${currency} account created`));
    refresh(true);
  };

  const railLabel = (c: Currency) => (c === 'EUR' ? 'SEPA · bank transfer' : c === 'GBP' ? 'Faster Payments' : 'ACH / Wire');

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-5 sm:p-6`}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-2xl bg-[#C7FF00]/20 flex items-center justify-center">
          <Building2 className="w-5 h-5 text-black dark:text-white" />
        </div>
        <div className="flex-1">
          <h3 className={`text-base font-semibold ${tc.text}`}>
            {tt('dash.va.title', 'Virtual accounts')}
          </h3>
          <p className={`text-xs ${tc.textMuted}`}>
            {availableCurrencies.length > 0
              ? tt('dash.va.subtitle', `Receive ${availableCurrencies.join(', ')} using BorderPay account rails.`)
              : tt('dash.va.subtitle.unavailable', 'Virtual accounts are not available for your country.')}
          </p>
        </div>
      </div>

      {!isApproved && (
        <div className={`flex items-center gap-2 p-3 rounded-2xl ${tc.bgAlt} border ${tc.border} mb-3`}>
          <Lock className={`w-4 h-4 ${tc.textMuted}`} />
          <p className={`text-xs ${tc.textMuted}`}>
            {tt('dash.va.locked', 'Verify your identity to enable virtual accounts.')}
          </p>
        </div>
      )}

      {loading ? (
        <div className="space-y-2 mb-3">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          {rows.length > 0 && (
            <ul className="space-y-2 mb-3">
              {rows.map(r => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelected(r)}
                    className={`w-full flex items-center gap-3 p-3 rounded-2xl ${tc.bgAlt} border ${tc.border} ${tc.hoverBg} transition`}
                  >
                    <AssetBadge symbol={r.currency} size={40} />
                    <div className="flex-1 min-w-0 text-left">
                      <div className={`text-sm font-semibold ${tc.text}`}>{r.currency} account</div>
                      <div className={`text-xs ${tc.textMuted} truncate`}>{railLabel(r.currency)}</div>
                    </div>
                    <span className={`text-[11px] font-medium ${r.status === 'active' ? 'text-[#C7FF00]' : tc.textMuted}`}>
                      {r.status === 'active' ? 'View details' : r.status}
                    </span>
                    <ChevronRight className={`w-4 h-4 ${tc.textMuted} flex-shrink-0`} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {missingCurrencies.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {missingCurrencies.map(c => (
                <button
                  key={c}
                  disabled={!isApproved || creating === c}
                  onClick={() => handleCreate(c)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition
                    ${isApproved
                      ? 'bg-[#C7FF00] text-black hover:opacity-90'
                      : `${tc.bgAlt} ${tc.textMuted} cursor-not-allowed`}`}
                >
                  {creating === c
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Plus className="w-3.5 h-3.5" />}
                  {tt('dash.va.add', 'Add')} {c}
                </button>
              ))}
            </div>
          )}

          {country && availableCurrencies.length === 0 && rows.length === 0 && (
            <div className={`p-3 rounded-2xl ${tc.bgAlt} border ${tc.border}`}>
              <p className={`text-xs ${tc.textMuted}`}>
                USD, EUR, and GBP virtual accounts are not currently available for your country.
              </p>
            </div>
          )}
        </>
      )}

      <AccountDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        va={selected ? { currency: selected.currency, rail: selected.rail, status: selected.status, account_details: selected.account_details } : null}
      />
    </motion.div>
  );
}

export default BridgeVirtualAccountsCard;
