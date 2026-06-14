/**
 * WalletVisuals — premium presentational pieces for the wallet surface:
 *   • AssetBadge        — brand-coloured coin / currency badge
 *   • WalletDetailSheet — stablecoin deposit details (address + network)
 *   • AccountDetailSheet— the virtual-account "letter": full bank deposit
 *                          instructions (holder, bank, IBAN/account, BIC/routing,
 *                          reference) with copy + the partner-name note.
 */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Copy, Check, Info, ArrowDownLeft } from 'lucide-react';
import { useThemeClasses } from '../../../utils/i18n/ThemeLanguageContext';
import { showToast } from '../../common/StatusToast';

// ── Brand palette ───────────────────────────────────────────────────────────
type Brand = { bg: string; fg: string; glyph: string; name: string };
const BRAND: Record<string, Brand> = {
  USDC:  { bg: '#2775CA', fg: '#FFFFFF', glyph: '$',  name: 'USD Coin' },
  USDT:  { bg: '#26A17B', fg: '#FFFFFF', glyph: '₮',  name: 'Tether'   },
  USDB:  { bg: '#1F4FFF', fg: '#FFFFFF', glyph: '$',  name: 'USDB'     },
  PYUSD: { bg: '#2D2FF6', fg: '#FFFFFF', glyph: '$',  name: 'PayPal USD' },
  EURC:  { bg: '#1A4BD6', fg: '#FFFFFF', glyph: '€',  name: 'Euro Coin' },
  EUR:   { bg: '#4F5BD5', fg: '#FFFFFF', glyph: '€',  name: 'Euro account' },
  GBP:   { bg: '#7B5BD5', fg: '#FFFFFF', glyph: '£',  name: 'Pound account' },
  USD:   { bg: '#1F9D57', fg: '#FFFFFF', glyph: '$',  name: 'US Dollar account' },
};
const brandOf = (sym: string): Brand =>
  BRAND[String(sym || '').toUpperCase()] ?? { bg: '#3A4150', fg: '#FFFFFF', glyph: '◎', name: String(sym || '').toUpperCase() };

export const chainLabel = (c?: string | null): string => {
  const k = String(c || '').toLowerCase();
  const m: Record<string, string> = {
    base: 'Base', tron: 'Tron', ethereum: 'Ethereum', eth: 'Ethereum',
    polygon: 'Polygon', solana: 'Solana', sol: 'Solana', arbitrum: 'Arbitrum',
    optimism: 'Optimism', bsc: 'BNB Chain', stellar: 'Stellar', celo: 'Celo',
  };
  return m[k] ?? (k ? k.charAt(0).toUpperCase() + k.slice(1) : '');
};

// Brand-coloured chain chip (poster-style network badge).
const CHAIN_BRAND: Record<string, { bg: string; fg: string; glyph: string }> = {
  base:     { bg: '#0052FF', fg: '#FFFFFF', glyph: 'B' },
  ethereum: { bg: '#627EEA', fg: '#FFFFFF', glyph: 'Ξ' },
  eth:      { bg: '#627EEA', fg: '#FFFFFF', glyph: 'Ξ' },
  polygon:  { bg: '#8247E5', fg: '#FFFFFF', glyph: '◆' },
  solana:   { bg: '#14F195', fg: '#000000', glyph: 'S' },
  sol:      { bg: '#14F195', fg: '#000000', glyph: 'S' },
  tron:     { bg: '#EB0029', fg: '#FFFFFF', glyph: 'T' },
  arbitrum: { bg: '#28A0F0', fg: '#FFFFFF', glyph: 'A' },
  optimism: { bg: '#FF0420', fg: '#FFFFFF', glyph: 'O' },
  bsc:      { bg: '#F0B90B', fg: '#000000', glyph: 'B' },
  stellar:  { bg: '#000000', fg: '#FFFFFF', glyph: '★' },
  celo:     { bg: '#FCFF52', fg: '#000000', glyph: 'C' },
};
export function ChainChip({ chain, size = 20 }: { chain: string; size?: number }) {
  const k = String(chain || '').toLowerCase();
  const b = CHAIN_BRAND[k] ?? { bg: '#3A4150', fg: '#FFFFFF', glyph: '◎' };
  return (
    <span
      style={{ width: size, height: size, background: b.bg, color: b.fg, fontSize: size * 0.55 }}
      className="inline-flex items-center justify-center rounded-full font-bold flex-shrink-0"
      aria-label={chainLabel(chain)}
    >
      {b.glyph}
    </span>
  );
}

// Fiat currencies render a flag (mobile renders these crisply); stablecoins use
// the brand-coloured coin glyph.
const FLAG: Record<string, string> = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧' };

export function AssetBadge({ symbol, size = 40 }: { symbol: string; size?: number }) {
  const sym = String(symbol || '').toUpperCase();
  const flag = FLAG[sym];
  if (flag) {
    return (
      <div
        style={{ width: size, height: size, fontSize: size * 0.62, lineHeight: 1 }}
        className="rounded-full flex items-center justify-center flex-shrink-0 bg-white/10 overflow-hidden"
        aria-hidden
      >
        {flag}
      </div>
    );
  }
  const b = brandOf(sym);
  return (
    <div
      style={{ width: size, height: size, background: b.bg, color: b.fg, fontSize: size * 0.46 }}
      className="rounded-full flex items-center justify-center font-bold flex-shrink-0 shadow-sm"
      aria-hidden
    >
      {b.glyph}
    </div>
  );
}

export const assetName = (sym: string) => brandOf(sym).name;

// ── Copyable row ────────────────────────────────────────────────────────────
function CopyRow({ label, value, tc }: { label: string; value?: string | null; tc: any }) {
  const [done, setDone] = React.useState(false);
  if (!value) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(String(value)); setDone(true); setTimeout(() => setDone(false), 1400); showToast.success('Copied'); }
    catch { /* noop */ }
  };
  return (
    <button onClick={copy} className={`w-full flex items-center gap-3 py-3 text-left border-b ${tc.borderLight} last:border-0`}>
      <div className="flex-1 min-w-0">
        <div className={`text-[11px] uppercase tracking-wider ${tc.textMuted} mb-0.5`}>{label}</div>
        <div className={`text-sm font-medium ${tc.text} break-all font-mono`}>{value}</div>
      </div>
      {done ? <Check className="w-4 h-4 text-[#C7FF00] flex-shrink-0" /> : <Copy className={`w-4 h-4 ${tc.textMuted} flex-shrink-0`} />}
    </button>
  );
}

// ── Bottom sheet shell ──────────────────────────────────────────────────────
function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const tc = useThemeClasses();
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
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function SheetHeader({ symbol, title, subtitle, onClose, tc }: { symbol: string; title: string; subtitle?: string; onClose: () => void; tc: any }) {
  return (
    <div className="flex items-center gap-3 p-5 pb-4">
      <AssetBadge symbol={symbol} size={44} />
      <div className="flex-1 min-w-0">
        <h2 className={`text-lg font-bold ${tc.text} truncate`}>{title}</h2>
        {subtitle && <p className={`text-xs ${tc.textMuted}`}>{subtitle}</p>}
      </div>
      <button onClick={onClose} aria-label="Close" className={`p-2 rounded-full ${tc.hoverBg}`}>
        <X className={`w-4 h-4 ${tc.textMuted}`} />
      </button>
    </div>
  );
}

// ── Stablecoin deposit sheet ────────────────────────────────────────────────
export function WalletDetailSheet({ open, onClose, wallet }: {
  open: boolean; onClose: () => void;
  wallet: { currency: string; chain: string; address: string } | null;
}) {
  const tc = useThemeClasses();
  const [done, setDone] = React.useState(false);
  if (!wallet) return <Sheet open={open} onClose={onClose}><div /></Sheet>;
  const sym  = String(wallet.currency).toUpperCase();
  const chn  = String(wallet.chain || '').toLowerCase();
  const addr = String(wallet.address || '');
  const copyAll = async () => {
    try { await navigator.clipboard.writeText(addr); setDone(true); setTimeout(() => setDone(false), 1400); showToast.success('Address copied'); }
    catch { /* noop */ }
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader symbol={sym} title={`${sym} · ${assetName(sym)}`} subtitle="Stablecoin deposit address" onClose={onClose} tc={tc} />

      <div className="px-5 pb-6">
        {/* Network row — coloured chain chip, always visible */}
        <div className={`flex items-center gap-2.5 rounded-2xl ${tc.bgAlt} border ${tc.cardBorder} px-4 py-3 mb-3`}>
          <ChainChip chain={chn} size={22} />
          <div className="flex-1 min-w-0">
            <div className={`text-[10px] uppercase tracking-wider ${tc.textMuted}`}>Network</div>
            <div className={`text-sm font-semibold ${tc.text}`}>{chainLabel(chn) || 'Unknown'}</div>
          </div>
        </div>

        {/* Address — large, mono, full-bleed, tap-anywhere to copy */}
        <button onClick={copyAll}
          className={`w-full text-left rounded-2xl ${tc.bgAlt} border ${tc.cardBorder} p-4 ${tc.hoverBg} transition mb-3`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-[10px] uppercase tracking-wider ${tc.textMuted}`}>{sym} address</span>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${done ? 'text-[#C7FF00]' : tc.textSecondary}`}>
              {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {done ? 'Copied' : 'Tap to copy'}
            </span>
          </div>
          <div className={`text-[13px] sm:text-sm font-mono leading-snug break-all ${tc.text}`} style={{ wordBreak: 'break-all' }}>
            {addr || <span className={tc.textMuted}>—</span>}
          </div>
        </button>

        {/* Safety note */}
        <div className={`rounded-2xl ${tc.bgAlt} border ${tc.cardBorder} p-3 flex items-start gap-2`}>
          <ArrowDownLeft className="w-4 h-4 text-[#C7FF00] mt-0.5 flex-shrink-0" />
          <p className={`text-xs ${tc.textSecondary} leading-relaxed`}>
            Send only <b>{sym}</b> on <b>{chainLabel(chn) || 'this network'}</b>. Funds sent on a
            different network may be lost.
          </p>
        </div>
      </div>
    </Sheet>
  );
}

// ── Virtual-account "letter" sheet ──────────────────────────────────────────
function pickDeposit(details: any) {
  const d = details?.source_deposit_instructions ?? details?.account_details ?? details ?? {};
  return {
    holder:   d.bank_beneficiary_name || d.account_holder_name || d.beneficiary_name || d.account_holder,
    bank:     d.bank_name,
    bankAddr: d.bank_address,
    account:  d.bank_account_number || d.account_number,
    routing:  d.bank_routing_number || d.routing_number || d.sort_code,
    iban:     d.iban,
    bic:      d.bic || d.swift,
    reference:d.payment_reference || d.reference || d.deposit_message,
    rail:     d.payment_rail,
  };
}

export function AccountDetailSheet({ open, onClose, va }: {
  open: boolean; onClose: () => void;
  va: { currency: string; rail?: string | null; status?: string; account_details: any } | null;
}) {
  const tc = useThemeClasses();
  if (!va) return <Sheet open={open} onClose={onClose}><div /></Sheet>;
  const cur = String(va.currency).toUpperCase();
  const d = pickDeposit(va.account_details);
  const railLabel = cur === 'EUR' ? 'SEPA' : cur === 'GBP' ? 'Faster Payments' : 'ACH / Wire';
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader symbol={cur} title={`${cur} account`} subtitle={`${railLabel} · bank transfer`} onClose={onClose} tc={tc} />
      <div className="px-5 pb-6">
        <div className={`rounded-2xl ${tc.bgAlt} border ${tc.cardBorder} p-3 flex items-start gap-2 mb-3`}>
          <Info className="w-4 h-4 text-[#C7FF00] mt-0.5 flex-shrink-0" />
          <p className={`text-xs ${tc.textSecondary}`}>
            Share these details to receive {cur} by bank transfer. The account holder shown is
            our regulated provider — that’s expected; funds are credited to your BorderPay wallet automatically.
          </p>
        </div>

        {(d.account || d.iban || d.holder) ? (
          <div className={`rounded-2xl ${tc.bgAlt} border ${tc.cardBorder} px-4`}>
            <CopyRow label="Account holder" value={d.holder} tc={tc} />
            <CopyRow label="Bank name" value={d.bank} tc={tc} />
            <CopyRow label="Bank address" value={d.bankAddr} tc={tc} />
            <CopyRow label="Account number" value={d.account} tc={tc} />
            <CopyRow label="IBAN" value={d.iban} tc={tc} />
            <CopyRow label={cur === 'GBP' ? 'Sort code' : 'Routing number'} value={d.routing} tc={tc} />
            <CopyRow label="BIC / SWIFT" value={d.bic} tc={tc} />
            <CopyRow label="Reference" value={d.reference} tc={tc} />
          </div>
        ) : (
          <div className={`rounded-2xl ${tc.bgAlt} border ${tc.cardBorder} p-4`}>
            <p className={`text-sm ${tc.textMuted}`}>
              Your {cur} account is being set up. Bank details arrive by email and appear here
              within a few minutes — pull to refresh.
            </p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
