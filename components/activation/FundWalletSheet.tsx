/**
 * FundWalletSheet — replaces the prior activation-fee paywall.
 *
 * The product no longer charges an activation fee. To unlock global virtual
 * accounts and money movement, users must hold a minimum balance ($20 USD-eq.)
 * in their BorderPay wallets. Funds REMAIN the user's — nothing is deducted.
 *
 * This sheet:
 *   • Shows the exact required messaging.
 *   • Shows current balance vs the $20 minimum (when known).
 *   • Surfaces the user's auto-provisioned USDC/USDT deposit addresses so they
 *     can fund right from this sheet (copy address + open Wallet for the QR).
 *   • Closes silently once balance reaches the minimum.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Wallet as WalletIcon, Copy, Check, ChevronRight, Loader2 } from 'lucide-react';
import { supabase } from '../../utils/supabase/client';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { AssetBadge, chainLabel, assetName } from '../dashboard/bridge/WalletVisuals';
import { showToast } from '../common/StatusToast';

/** Per-policy floors. Individuals $20, businesses $50. Sheet receives the exact
 *  min via the 402 detail when triggered by a gate; falls back to these per
 *  account_type when opened manually. */
export const FUNDING_MIN_USD_INDIVIDUAL = 20;
export const FUNDING_MIN_USD_BUSINESS   = 50;
const fundingMessage = (minUsd: number) =>
  `Maintain at least $${minUsd} in USDC or USDT to keep transfers and payouts available. ` +
  'Your funds stay in your wallet and remain available to you.';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Best-known current balance in USD-equivalent. Optional; sheet fetches own data. */
  currentUsd?: number;
  /** Minimum required (from the funding_required event). Falls back per account type. */
  minUsd?: number;
  accountType?: 'individual' | 'business';
  /** Navigates the host app (e.g. to the Wallet tab). */
  onOpenWallet?: () => void;
  /** Optional: jump straight to Receive so the user can copy funding details. */
  onOpenReceive?: () => void;
  userId?: string;
}

interface Stable { id: string; currency: string; chain: string; address: string }

export function FundWalletSheet({ open, onClose, currentUsd, minUsd, accountType, onOpenWallet, onOpenReceive, userId }: Props) {
  const minRequired = minUsd ?? (accountType === 'business' ? FUNDING_MIN_USD_BUSINESS : FUNDING_MIN_USD_INDIVIDUAL);
  const tc = useThemeClasses();
  const [stables, setStables] = useState<Stable[]>(() => {
    try { return JSON.parse(localStorage.getItem('borderpay_wallets_ind_v1') || '[]'); } catch { return []; }
  });
  const [loading, setLoading] = useState(stables.length === 0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('bridge_wallets')
          .select('id, currency, chain, address')
          .eq('user_id', userId)
          .not('address', 'is', null);
        if (alive && Array.isArray(data)) setStables(data as Stable[]);
      } catch { /* best-effort */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [open, userId]);

  const progress = useMemo(() => {
    const cur = Math.max(0, Number(currentUsd ?? 0));
    return { cur, pct: Math.min(100, (cur / minRequired) * 100) };
  }, [currentUsd, minRequired]);

  const copy = async (s: Stable) => {
    try { await navigator.clipboard.writeText(s.address); setCopiedId(s.id); setTimeout(() => setCopiedId(null), 1400); showToast.success('Address copied'); }
    catch { /* noop */ }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="fixed inset-x-0 bottom-0 z-[9999] sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md">
            <div className={`mx-auto w-full max-w-md ${tc.card} border ${tc.cardBorder} rounded-t-3xl sm:rounded-3xl overflow-hidden`}
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>

              {/* header */}
              <div className="flex items-center gap-3 p-5 pb-3">
                <div className="w-11 h-11 rounded-2xl bg-[#C7FF00]/15 flex items-center justify-center">
                  <WalletIcon className="w-5 h-5 text-[#C7FF00]" />
                </div>
                <div className="flex-1">
                  <h2 className={`text-lg font-bold ${tc.text}`}>Fund Wallet</h2>
                  <p className={`text-[11px] uppercase tracking-wider ${tc.textMuted}`}>Minimum Wallet Funding Requirement</p>
                </div>
                <button onClick={onClose} aria-label="Close" className={`p-2 rounded-full ${tc.hoverBg}`}>
                  <X className={`w-4 h-4 ${tc.textMuted}`} />
                </button>
              </div>

              <div className="px-5 pb-5">
                <p className={`text-sm ${tc.textSecondary} leading-relaxed mb-4`}>{fundingMessage(minRequired)}</p>

                {/* Progress card */}
                <div className={`rounded-2xl border ${tc.cardBorder} ${tc.bgAlt} p-4 mb-4`}>
                  <div className="flex items-end justify-between mb-2">
                    <div>
                      <div className={`text-[11px] uppercase tracking-wider ${tc.textMuted}`}>Your balance</div>
                      <div className={`text-2xl font-bold ${tc.text}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        ${progress.cur.toFixed(2)}
                      </div>
                    </div>
                    <div className={`text-xs ${tc.textMuted}`}>of ${minRequired.toFixed(0)} min</div>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full bg-[#C7FF00] transition-[width]" style={{ width: `${progress.pct}%` }} />
                  </div>
                </div>

                {/* Stablecoin deposit addresses */}
                <p className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${tc.textMuted} mb-2 px-1`}>
                  Fund by sending stablecoin
                </p>
                {loading ? (
                  <div className="py-6 text-center"><Loader2 className={`w-5 h-5 ${tc.textMuted} animate-spin mx-auto`} /></div>
                ) : stables.length === 0 ? (
                  <div className={`rounded-2xl border ${tc.cardBorder} ${tc.bgAlt} p-4 text-center`}>
                    <p className={`text-sm ${tc.textMuted}`}>Your stablecoin wallets are being set up. Refresh in a moment.</p>
                  </div>
                ) : (
                  <div className={`rounded-2xl border ${tc.cardBorder} ${tc.bgAlt} overflow-hidden`}>
                    {stables.map((s, i) => {
                      const sym = s.currency.toUpperCase();
                      const done = copiedId === s.id;
                      return (
                        <button key={s.id} onClick={() => copy(s)}
                          className={`w-full flex items-center gap-3 p-3 text-left ${tc.hoverBg} ${i > 0 ? `border-t ${tc.borderLight}` : ''}`}>
                          <AssetBadge symbol={sym} size={40} />
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-semibold ${tc.text}`}>{assetName(sym)} <span className={`text-xs font-medium ${tc.textMuted}`}>({chainLabel(s.chain)})</span></div>
                            <div className={`text-[11px] font-mono ${tc.textMuted} truncate`}>{s.address}</div>
                          </div>
                          {done ? <Check className="w-4 h-4 text-[#C7FF00] flex-shrink-0" /> : <Copy className={`w-4 h-4 ${tc.textMuted} flex-shrink-0`} />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* CTAs */}
                <div className="mt-5 flex gap-2">
                  <button onClick={onClose} className={`flex-1 py-3 rounded-full border ${tc.cardBorder} ${tc.text} font-semibold text-sm`}>
                    Not now
                  </button>
                  <button onClick={() => { onClose(); onOpenReceive?.(); }}
                    className={`flex-1 py-3 rounded-full border ${tc.cardBorder} ${tc.text} font-semibold text-sm inline-flex items-center justify-center gap-1.5`}>
                    Receive
                  </button>
                  <button onClick={() => { onClose(); onOpenWallet?.(); }}
                    className="flex-1 py-3 rounded-full bg-[#C7FF00] text-black font-semibold text-sm inline-flex items-center justify-center gap-1.5">
                    Open Wallet <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default FundWalletSheet;
