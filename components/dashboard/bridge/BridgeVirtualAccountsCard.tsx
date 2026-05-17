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
import { motion } from 'motion/react';
import { Building2, Copy, Plus, Loader2, Lock } from 'lucide-react';
import { supabase } from '../../../utils/supabase/client';
import { backendAPI } from '../../../utils/api/backendAPI';
import { useThemeLanguage, useThemeClasses } from '../../../utils/i18n/ThemeLanguageContext';
import { showToast } from '../../common/StatusToast';

type Currency = 'USD' | 'EUR' | 'GBP';

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

const ALL_CURRENCIES: Currency[] = ['USD', 'EUR', 'GBP'];

export function BridgeVirtualAccountsCard({ userId, kycApproved, isBusiness = false }: Props) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const [rows, setRows]       = useState<VARow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<Currency | null>(null);
  const [derivedApproved, setDerivedApproved] = useState(false);

  const isApproved = kycApproved ?? derivedApproved;

  const refresh = async () => {
    const q = supabase.from('bridge_virtual_accounts').select('*').order('created_at', { ascending: false });
    const { data } = isBusiness
      ? await q.eq('business_user_id', userId)
      : await q.eq('user_id', userId);
    setRows((data as VARow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [userId, isBusiness]);

  useEffect(() => {
    if (kycApproved !== undefined) return;
    let alive = true;
    (async () => {
      if (isBusiness) {
        const { data } = await supabase
          .from('business_profiles')
          .select('bridge_kyb_status')
          .eq('user_id', userId)
          .maybeSingle();
        if (alive) setDerivedApproved(data?.bridge_kyb_status === 'approved');
      } else {
        const { data } = await supabase
          .from('user_profiles')
          .select('bridge_kyc_status')
          .eq('id', userId)
          .maybeSingle();
        if (alive) setDerivedApproved(data?.bridge_kyc_status === 'approved');
      }
    })();
    return () => { alive = false; };
  }, [userId, isBusiness, kycApproved]);

  const haveCurrencies = useMemo(() => new Set(rows.map(r => r.currency)), [rows]);
  const missingCurrencies = ALL_CURRENCIES.filter(c => !haveCurrencies.has(c));

  const handleCreate = async (currency: Currency) => {
    setCreating(currency);
    const r = await backendAPI.bridge.virtualAccount.create({ currency });
    setCreating(null);
    if (!r.success) {
      showToast.error(r.error || tt('dash.va.create.failed', 'Could not create the virtual account.'));
      return;
    }
    showToast.success(tt('dash.va.create.success', `${currency} account created`));
    refresh();
  };

  const handleCopy = async (text?: string | null) => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); showToast.success(tt('common.copied', 'Copied')); } catch { /* noop */ }
  };

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
            {tt('dash.va.subtitle', 'Receive USD, EUR, and GBP via bank transfer.')}
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
        <div className="flex items-center gap-2 py-4">
          <Loader2 className={`w-4 h-4 ${tc.textSecondary} animate-spin`} />
          <span className={tc.textMuted}>{tt('common.loading', 'Loading…')}</span>
        </div>
      ) : (
        <>
          {rows.length > 0 && (
            <ul className="space-y-2 mb-3">
              {rows.map(r => (
                <li key={r.id} className={`p-3 rounded-2xl ${tc.bgAlt} border ${tc.border}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-semibold ${tc.text}`}>{r.currency}</span>
                    <span className={`text-xs ${r.status === 'active' ? 'text-green-500' : tc.textMuted}`}>{r.status}</span>
                  </div>
                  {r.account_details?.bank_account_number && (
                    <button onClick={() => handleCopy(r.account_details.bank_account_number)}
                            className={`flex items-center gap-1 text-xs ${tc.textSecondary} hover:${tc.text}`}>
                      {r.account_details.bank_account_number}
                      <Copy className="w-3 h-3" />
                    </button>
                  )}
                  {r.account_details?.iban && (
                    <button onClick={() => handleCopy(r.account_details.iban)}
                            className={`flex items-center gap-1 text-xs ${tc.textSecondary} hover:${tc.text}`}>
                      IBAN: {r.account_details.iban}
                      <Copy className="w-3 h-3" />
                    </button>
                  )}
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
        </>
      )}
    </motion.div>
  );
}

export default BridgeVirtualAccountsCard;
