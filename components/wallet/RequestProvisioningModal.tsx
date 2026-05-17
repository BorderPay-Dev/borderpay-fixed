/**
 * BorderPay Africa — Request Provisioning Modal (v2)
 *
 * Per-product policy aligned with the Bridge migration:
 *
 *   • Global Account        → Bridge virtual account for USD/EUR/GBP.
 *
 *   • African Currency      → Future-state local rails/mobile money partner.
 *                              Requests are queued for ops visibility only.
 *
 *   • Stablecoin            → Bridge wallet.
 *
 *   • Virtual USD Card      → Coming Soon. Card issuance is paused under the
 *                              current Bridge plan.
 *
 * Provider errors are surfaced to the user. Only intentional future-state
 * products create `pending_provisioning_requests` rows.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Banknote, Globe2, Coins, CreditCard, Loader2, Check, AlertTriangle, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { supabase } from '../../utils/supabase/client';
import { authAPI } from '../../utils/supabase/client';
import { isFullEnrollment } from '../../utils/config/environment';

interface RequestProvisioningModalProps {
  open: boolean;
  onClose: () => void;
  onProvisioned?: () => void;
}

type ProductKey = 'usd-va' | 'african' | 'stablecoin' | 'card';

interface Product {
  key:      ProductKey;
  label:    string;
  blurb:    string;
  Icon:     any;
  accent:   string;
}

const AFRICAN_CURRENCIES = ['NGN', 'KES', 'GHS', 'UGX', 'TZS', 'XAF', 'XOF'] as const;
const STABLECOINS        = ['USDT', 'USDC', 'PYUSD', 'USDB'] as const;
const STABLECOIN_NETWORKS: Record<string, string[]> = {
  USDT:  ['ETH', 'TRON', 'BSC', 'POLYGON'],
  USDC:  ['ETH', 'SOLANA', 'BSC', 'POLYGON'],
  PYUSD: ['ETH', 'SOLANA'],
  USDB:  ['BASE'],   // Bridge custodial USDB, canonical chain
};

export function RequestProvisioningModal({ open, onClose, onProvisioned }: RequestProvisioningModalProps) {
  const [selection, setSelection]       = useState<Product | null>(null);
  const [currency, setCurrency]         = useState<string>('');
  const [network, setNetwork]           = useState<string>('SOLANA');
  const [brand, setBrand]               = useState<'VISA' | 'MASTERCARD'>('VISA');
  const [initialAmount, setInitialAmount] = useState<number>(10);
  const [submitting, setSubmitting]     = useState(false);
  const [doneMessage, setDoneMessage]   = useState<string | null>(null);
  const [errMessage, setErrMessage]     = useState<string | null>(null);

  // Live-refreshed user state — covers a stale localStorage cache so we
  // don't refuse a verified user because of cached 'pending'.
  const cachedUser           = authAPI.getStoredUser();
  const [verified, setVerified]                     = useState<boolean>(isFullEnrollment(cachedUser?.kyc_status));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await backendAPI.user.getProfile();
        if (cancelled) return;
        if (r?.success && r.data?.user) {
          setVerified(isFullEnrollment(r.data.user.kyc_status));
        }
      } catch { /* ignore — keep cached */ }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const products: Product[] = [
    { key: 'usd-va',     label: 'Global Account (USD/EUR/GBP)', blurb: 'Receive via ACH · SEPA · Faster Payments', Icon: Banknote, accent: '#10B981' },
    { key: 'african',    label: 'African Currency',             blurb: 'Local currency and mobile money rails coming soon', Icon: Globe2,   accent: '#8B5CF6' },
    { key: 'stablecoin', label: 'Stablecoin Wallet',            blurb: 'USDC · USDT · PYUSD · USDB',                Icon: Coins,    accent: '#F59E0B' },
    { key: 'card',       label: 'Virtual Card',                 blurb: 'Coming soon — card issuance is paused',     Icon: CreditCard, accent: '#C7FF00' },
  ];

  const reset = () => {
    setSelection(null);
    setCurrency('');
    setNetwork('SOLANA');
    setBrand('VISA');
    setInitialAmount(10);
    setSubmitting(false);
    setDoneMessage(null);
    setErrMessage(null);
  };

  const handleSelect = (p: Product) => {
    if (p.key === 'card') {
      // Cards are paused until our new card infrastructure is live.
      // Surface a clear toast and don't open the configuration step.
      toast.error('Cards are launching soon. We’ve paused new card issuance during the migration.');
      return;
    }
    setSelection(p);
    setDoneMessage(null);
    setErrMessage(null);
    if (p.key === 'usd-va')          setCurrency('USD');
    else if (p.key === 'african')    setCurrency('NGN');
    else if (p.key === 'stablecoin') { setCurrency('USDC'); setNetwork('SOLANA'); }
  };

  /**
   * File a pending_provisioning_requests row for ops to fulfil. Returns the
   * row id on success, throws on failure.
   */
  const queuePending = async (productType: string, payload: Record<string, any>, errorMsg?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { data, error } = await supabase
      .from('pending_provisioning_requests')
      .insert({
        user_id:         user.id,
        product_type:    productType,
        currency:        payload.currency || null,
        network:         payload.network  || null,
        brand:           payload.brand    || null,
        initial_amount:  payload.initial_amount ?? null,
        request_payload: payload,
        error:           errorMsg || null,
        source:          'user_app',
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as any)?.id;
  };

  const submit = async () => {
    if (!selection) return;
    setSubmitting(true);
    setErrMessage(null);
    setDoneMessage(null);

    try {
      // Universal pre-flight: identity verification must be complete before
      // requesting live financial products.
      if (!verified) {
        setErrMessage('Complete identity verification before requesting financial products.');
        return;
      }

      if (selection.key === 'stablecoin') {
        await submitStablecoin();
      } else if (selection.key === 'usd-va') {
        await submitUsdVa();
      } else if (selection.key === 'african') {
        await submitAfrican();
      }
      // 'card' is intentionally not handled here. Cards are Coming Soon and
      // handleSelect() returns before a card selection can be set, so this
      // branch is unreachable. The dead submitCard() function below is
      // retained as a no-op for the duration of the cards quarantine.
    } catch (e: any) {
      const msg = e?.message || 'Request failed. Please try again.';
      setErrMessage(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Stablecoin ──────────────────────────────────────────────────────
  const submitStablecoin = async () => {
    const r: any = await backendAPI.provisioning.request({
      type: 'stablecoin', currency, network: network.toLowerCase(),
    });
    if (r?.success) {
      const m = `${currency} address generated. Check your wallet.`;
      setDoneMessage(m); toast.success(m); onProvisioned?.();
      return;
    }
    const detail = r?.error || 'Unable to create this stablecoin wallet right now.';
    setErrMessage(detail);
    toast.error(detail);
  };

  // ── Global Account (USD / EUR / GBP) ────────────────────────────────
  const submitUsdVa = async () => {
    const ccy = (currency || 'USD').toUpperCase();
    if (!['USD', 'EUR', 'GBP'].includes(ccy)) {
      setErrMessage(`Unsupported currency: ${ccy}`); return;
    }
    const r: any = await backendAPI.provisioning.request({
      type: 'virtual_account', currency: ccy,
    });
    if (r?.success) {
      const m = `${ccy} global account active. Routing details have been emailed to you.`;
      setDoneMessage(m); toast.success(m); onProvisioned?.();
      return;
    }
    if (r?.code === 'kyc_not_approved') {
      setErrMessage('Complete KYC verification before requesting global accounts.');
      return;
    }
    const detail = r?.error || 'Unable to create this global account right now.';
    setErrMessage(detail);
    toast.error(detail);
  };

  // ── African Currency Virtual Account ────────────────────────────────
  const submitAfrican = async () => {
    const ccy = currency.toUpperCase();
    await queuePending('local_currency', { currency: ccy },
      `${ccy} local currency rails are not live yet. Filed for future provisioning.`);
    const m = `${ccy} request queued — our ops team will complete setup and email you.`;
    setDoneMessage(m); toast.success(m);
    onProvisioned?.();
  };

  // QUARANTINED: Virtual card issuance is paused. handleSelect() returns
  // before a card selection can be set, and submit() no longer routes to
  // this function. Retained as a no-op so any stale call surfaces a clean
  // Coming Soon toast instead of attempting card provisioning.
  const submitCard = async () => {
    toast.error('Cards are Coming Soon.');
  };
  void submitCard;

  if (!open) return null;

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      <motion.div
        key="provisioning-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6"
        onClick={() => { if (!submitting) { reset(); onClose(); } }}
      >
        <motion.div
          key="provisioning-sheet"
          initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="relative w-full sm:max-w-lg bg-[#0B0F1A] text-white rounded-t-[26px] sm:rounded-[26px] border border-white/10 shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 pt-5 pb-3 flex items-start justify-between">
            <div>
              <h3 className="text-lg font-bold">Add a new funding option</h3>
              <p className="text-xs text-white/50 mt-0.5">
                {selection ? 'Confirm details and submit.' : 'Pick a wallet or card to provision.'}
              </p>
            </div>
            <button
              onClick={() => { if (!submitting) { reset(); onClose(); } }}
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center"
              disabled={submitting} aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 pb-5">
            {!verified && !selection && (
              <div className="mb-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200">
                  Complete identity verification first to request financial products.
                </p>
              </div>
            )}

            {!selection && (
              <div className="grid grid-cols-2 gap-3">
                {products.map((p) => {
                  const Icon = p.Icon;
                  return (
                    <motion.button
                      key={p.key}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleSelect(p)}
                      className="relative p-4 rounded-2xl bg-white/[0.05] border border-white/10 hover:border-white/25 hover:bg-white/[0.08] text-left transition-all"
                    >
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                        style={{ background: `${p.accent}1f`, color: p.accent }}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <p className="text-sm font-semibold">{p.label}</p>
                      <p className="text-[11px] text-white/50 mt-0.5 leading-snug">{p.blurb}</p>
                    </motion.button>
                  );
                })}
              </div>
            )}

            {selection && !doneMessage && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.05] border border-white/10">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ background: `${selection.accent}1f`, color: selection.accent }}
                  >
                    <selection.Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{selection.label}</p>
                    <p className="text-[11px] text-white/50 truncate">{selection.blurb}</p>
                  </div>
                  <button
                    onClick={reset} disabled={submitting}
                    className="text-[11px] uppercase tracking-wider text-white/60 hover:text-white"
                  >
                    Change
                  </button>
                </div>

                {/* African currency picker */}
                {selection.key === 'african' && (
                  <div>
	                    <label className="text-[11px] uppercase tracking-wider text-white/50">Currency</label>
	                    <div className="mt-2 grid grid-cols-4 gap-2">
	                      {AFRICAN_CURRENCIES.map((c) => (
	                        <button
	                          key={c}
	                          onClick={() => setCurrency(c)}
	                          disabled={submitting}
	                          title="Coming soon"
	                          className={`py-2 rounded-lg text-xs font-semibold border ${
	                            currency === c
	                              ? 'bg-[#C7FF00] text-black border-[#C7FF00]'
	                              : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
	                          }`}
	                        >
	                          {c}<span className="text-[8px] ml-0.5 align-top">●</span>
	                        </button>
	                      ))}
	                    </div>
	                    <p className="text-[10px] text-white/40 mt-2">
	                      ● Coming soon. Local currency and mobile money rails are queued for future rollout.
	                    </p>
                  </div>
                )}

                {/* Stablecoin picker */}
                {selection.key === 'stablecoin' && (
                  <>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-white/50">Coin</label>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {STABLECOINS.map((c) => (
                          <button
                            key={c}
                            onClick={() => {
                              setCurrency(c);
                              const nets = STABLECOIN_NETWORKS[c] || ['ETH'];
                              if (!nets.includes(network)) setNetwork(nets[0]);
                            }}
                            disabled={submitting}
                            className={`py-2 rounded-lg text-xs font-semibold border ${
                              currency === c
                                ? 'bg-[#C7FF00] text-black border-[#C7FF00]'
                                : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
                            }`}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-white/50">Network</label>
                      <div className="mt-2 grid grid-cols-4 gap-2">
                        {(STABLECOIN_NETWORKS[currency] || ['ETH']).map((n) => (
                          <button
                            key={n}
                            onClick={() => setNetwork(n)}
                            disabled={submitting}
                            className={`py-2 rounded-lg text-xs font-semibold border ${
                              network === n
                                ? 'bg-[#C7FF00] text-black border-[#C7FF00]'
                                : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Card brand + initial funding */}
                {selection.key === 'card' && (
                  <>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-white/50">Network</label>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {(['VISA', 'MASTERCARD'] as const).map((b) => (
                          <button
                            key={b}
                            onClick={() => setBrand(b)}
                            disabled={submitting}
                            className={`py-2 rounded-lg text-xs font-semibold border ${
                              brand === b
                                ? 'bg-[#C7FF00] text-black border-[#C7FF00]'
                                : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
                            }`}
                          >
                            {b}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-white/50">Initial load (USD)</label>
                      <input
                        type="number"
                        min={0} step={1} value={initialAmount}
                        disabled={submitting}
                        onChange={(e) => setInitialAmount(Math.max(0, Number(e.target.value) || 0))}
                        className="mt-2 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#C7FF00]"
                      />
                      <p className="text-[10px] text-white/40 mt-1">
                        Leave 0 to issue a card with no initial balance.
                      </p>
                    </div>
                  </>
                )}

                {selection.key === 'usd-va' && (
                  <>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-white/50">Currency</label>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {(['USD', 'EUR', 'GBP'] as const).map((c) => (
                          <button
                            key={c}
                            onClick={() => setCurrency(c)}
                            disabled={submitting}
                            className={`py-2 rounded-lg text-xs font-semibold border ${
                              currency === c
                                ? 'bg-[#C7FF00] text-black border-[#C7FF00]'
                                : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
                            }`}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10">
                      <p className="text-xs text-white/70 leading-relaxed">
                        Global accounts settle into your stablecoin wallet via {currency === 'USD' ? 'ACH/wire' : currency === 'EUR' ? 'SEPA' : 'Faster Payments'}.
                        Activation runs once your KYC is verified by our partner — typically within
                        one business day. We'll email the routing/account/IBAN as soon as it's live.
                      </p>
                    </div>
                  </>
                )}

                {errMessage && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-200">{errMessage}</p>
                  </div>
                )}

                <button
                  onClick={submit}
                  disabled={submitting || !verified}
                  className="w-full h-11 rounded-xl bg-[#C7FF00] text-black font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>Request {selection.label}</>
                  )}
                </button>
	                <p className="text-[10px] text-white/40 text-center">
	                  Available Bridge products provision from this request. Future local rails are queued and you'll get an email when they're live.
	                </p>
              </div>
            )}

            {selection && doneMessage && (
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-12 h-12 rounded-full bg-[#C7FF00]/20 flex items-center justify-center mb-3">
                  <Check className="w-6 h-6 text-[#C7FF00]" />
                </div>
                <p className="text-sm font-semibold">Request submitted</p>
                <p className="text-xs text-white/60 mt-1 max-w-xs">{doneMessage}</p>
                <button
                  onClick={() => { reset(); onClose(); }}
                  className="mt-4 px-4 h-10 rounded-xl bg-white/10 border border-white/15 text-sm font-semibold"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default RequestProvisioningModal;
