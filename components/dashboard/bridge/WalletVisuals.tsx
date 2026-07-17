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
import { X, Copy, Check, Info, ArrowDownLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
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

// Brand-coloured network badge + real brand SVG marks.
const CHAIN_BRAND: Record<string, { bg: string; fg: string }> = {
  base:     { bg: '#0052FF', fg: '#FFFFFF' },
  ethereum: { bg: '#627EEA', fg: '#FFFFFF' },
  eth:      { bg: '#627EEA', fg: '#FFFFFF' },
  polygon:  { bg: '#8247E5', fg: '#FFFFFF' },
  solana:   { bg: '#0B0B0B', fg: '#14F195' },
  sol:      { bg: '#0B0B0B', fg: '#14F195' },
  tron:     { bg: '#EB0029', fg: '#FFFFFF' },
  arbitrum: { bg: '#28A0F0', fg: '#FFFFFF' },
  optimism: { bg: '#FF0420', fg: '#FFFFFF' },
  bsc:      { bg: '#F0B90B', fg: '#000000' },
  stellar:  { bg: '#000000', fg: '#FFFFFF' },
  celo:     { bg: '#FCFF52', fg: '#000000' },
};

// Real brand marks (inline SVG, scaled to the chip). Defaults to a circle dot
// for unknown chains.
function ChainMark({ chain, fg }: { chain: string; fg: string }) {
  const k = String(chain || '').toLowerCase();
  const common = { fill: fg, width: '60%', height: '60%' };
  if (k === 'base') {
    // Base "B" mark — circular with cutout
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm-1.6 14.2H6V7.8h4.6c2.5 0 4.2 1.2 4.2 3.4 0 1.6-1 2.6-2.5 2.9 1.8.3 3 1.3 3 3 0 2.3-1.8 3.5-4.3 3.5h-.6v-.6z" />
      </svg>
    );
  }
  if (k === 'tron') {
    // Tron triangle "T"
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M3 4l9 17 9-17-9 4-9-4zm9 5.3l6.4-2.9-3.2 6.2L12 9.3zm-.7 0L5 6.4 8.2 12.6l3.1-3.3zm-2.6 4.4l3.3 6.3V13.7l-3.3 0zm4 6.3l3.3-6.3-3.3 0v6.3z" />
      </svg>
    );
  }
  if (k === 'ethereum' || k === 'eth' || k === 'arbitrum') {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M12 2L5 12l7 4 7-4-7-10zm0 14l-7-4 7 10 7-10-7 4z" />
      </svg>
    );
  }
  if (k === 'polygon') {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M16 8.5l-2.5-1.4-2.5 1.4v2.8L8.5 12 6 10.6V7.8L8.5 6.4 11 7.8V9l5-2.9V8.5zm-8 7L10.5 17l2.5-1.5v-2.8l2.5-1.3 2.5 1.4v2.8L15.5 18 13 16.6v-1.1L8 18.4v-2.9z" />
      </svg>
    );
  }
  if (k === 'solana' || k === 'sol') {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M5.4 17.3a.7.7 0 0 1 .5-.2H21l-2.6 2.6a.7.7 0 0 1-.5.2H2.8L5.4 17.3zm0-9.5a.7.7 0 0 1 .5-.2H21L18.4 4.9a.7.7 0 0 1-.5-.2H2.8L5.4 7.8zm13.2 4.7a.7.7 0 0 0-.5-.2H2.8L5.4 15a.7.7 0 0 0 .5.2h15.2l-2.5-2.7z" />
      </svg>
    );
  }
  // Fallback dot
  return <span style={{ width: 6, height: 6, background: fg, borderRadius: '50%' }} />;
}

export function ChainChip({ chain, size = 20 }: { chain: string; size?: number }) {
  const k = String(chain || '').toLowerCase();
  const b = CHAIN_BRAND[k] ?? { bg: '#3A4150', fg: '#FFFFFF' };
  return (
    <span
      style={{ width: size, height: size, background: b.bg }}
      className="inline-flex items-center justify-center rounded-full flex-shrink-0"
      aria-label={chainLabel(chain)}
    >
      <ChainMark chain={chain} fg={b.fg} />
    </span>
  );
}

// Fiat currencies render a flag (mobile renders these crisply); stablecoins use
// the brand-coloured coin glyph.
const FLAG: Record<string, string> = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧' };
const STABLE_ICON_URL: Record<string, string> = {
  USDC: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/usdc.png',
  USDT: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/usdt.png',
  PYUSD: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/pyusd.png',
  EURC: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/eurc.png',
  USDB: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/usdb.png',
};

export function AssetBadge({ symbol, size = 40 }: { symbol: string; size?: number }) {
  const sym = String(symbol || '').toUpperCase();
  const flag = FLAG[sym];
  const [iconFailed, setIconFailed] = React.useState(false);
  const iconUrl = STABLE_ICON_URL[sym];
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
  if (iconUrl && !iconFailed) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-full flex items-center justify-center flex-shrink-0 bg-white/10 overflow-hidden"
        aria-hidden
      >
        <img
          src={iconUrl}
          alt={`${sym} icon`}
          className="w-[78%] h-[78%] object-contain"
          onError={() => setIconFailed(true)}
          loading="lazy"
        />
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
  const sheetId = React.useId();
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!open) return undefined;
    window.dispatchEvent(new CustomEvent('borderpay:wallet_detail_sheet_visibility', { detail: { open: true, id: sheetId } }));
    return () => {
      window.dispatchEvent(new CustomEvent('borderpay:wallet_detail_sheet_visibility', { detail: { open: false, id: sheetId } }));
    };
  }, [open, sheetId]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} className="fixed inset-0 z-[2147483600] bg-black/70 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="fixed inset-x-0 bottom-0 z-[2147483601] sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md">
            <div className={`mx-auto w-full max-w-md ${tc.card} border ${tc.cardBorder} rounded-t-3xl sm:rounded-3xl overflow-y-auto overscroll-contain`}
              style={{
                // Make the sheet scrollable AND clear of the floating tab bar
                // (which sits roughly 96px above the safe-area inset). Without
                // this padding the address / IBAN rows were occluded.
                maxHeight: 'calc(100dvh - 24px)',
                paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 110px)',
              }}>
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
  const [showHowToDeposit, setShowHowToDeposit] = React.useState(false);
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

        {/* QR code — Binance-style. White panel so dark-mode scanners read it. */}
        {addr && (
          <div className={`rounded-2xl border ${tc.cardBorder} ${tc.bgAlt} p-4 mb-3 flex flex-col items-center`}>
            <div className="bg-white rounded-xl p-3" aria-label={`${sym} ${chainLabel(chn)} deposit QR`}>
              <QRCodeSVG value={addr} size={184} level="M" includeMargin={false} />
            </div>
            <p className={`text-[11px] ${tc.textMuted} mt-3 text-center`}>
              Scan to receive <b className={tc.text}>{sym}</b> on <b className={tc.text}>{chainLabel(chn) || 'this network'}</b>
            </p>
          </div>
        )}

        {/* Address — large, mono, full-bleed, tap-anywhere to copy */}
        <button onClick={copyAll}
          className={`w-full text-left rounded-2xl ${tc.bgAlt} border ${tc.cardBorder} p-4 ${tc.hoverBg} transition mb-3`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-[10px] uppercase tracking-wider ${tc.textMuted}`}>{sym} deposit address</span>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${done ? 'text-[#C7FF00]' : tc.textSecondary}`}>
              {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {done ? 'Copied' : 'Tap to copy'}
            </span>
          </div>
          <div className={`text-[13px] sm:text-sm font-mono leading-snug break-all ${tc.text}`} style={{ wordBreak: 'break-all' }}>
            {addr || <span className={tc.textMuted}>—</span>}
          </div>
        </button>

        {/* Safety note — short, bright */}
        <div className={`rounded-2xl ${tc.bgAlt} border ${tc.cardBorder} p-3 flex items-start gap-2 mb-4`}>
          <ArrowDownLeft className="w-4 h-4 text-[#C7FF00] mt-0.5 flex-shrink-0" />
          <p className={`text-xs ${tc.textSecondary} leading-relaxed`}>
            Send only <b>{sym}</b> on <b>{chainLabel(chn) || 'this network'}</b>. Funds sent on a
            different network may be lost.
          </p>
        </div>

        {/* Collapsible instructions drawer */}
        <div className={`rounded-2xl border ${tc.cardBorder} ${tc.bgAlt} overflow-hidden mb-3`}>
          <button
            onClick={() => setShowHowToDeposit((v) => !v)}
            className={`w-full px-4 py-3 flex items-center justify-between text-left ${tc.hoverBg}`}
          >
            <span className={`text-xs font-semibold ${tc.text}`}>How to deposit <span className={`${tc.textMuted} font-medium`}>see more</span></span>
            {showHowToDeposit
              ? <ChevronUp className={`w-4 h-4 ${tc.textMuted}`} />
              : <ChevronDown className={`w-4 h-4 ${tc.textMuted}`} />}
          </button>
          {showHowToDeposit && (
            <ol className={`px-4 pb-3 space-y-2.5`}>
              {[
                <>Copy the address above or scan the QR with the sender&apos;s wallet app.</>,
                <>Make sure the sender picks <b>{chainLabel(chn) || sym}</b> as the network — sending on a different network can lose the funds.</>,
                <>Verify the sender&apos;s preview shows the matching address before confirming.</>,
                <>Funds usually arrive within a few minutes after network confirmations; track it in <b>Activity</b>.</>,
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#C7FF00] text-black text-[11px] font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className={`text-xs ${tc.textSecondary} leading-relaxed pt-0.5`}>{step}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Quick facts strip */}
        <div className={`grid grid-cols-3 gap-2`}>
          <div className={`rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-3 py-2.5`}>
            <div className={`text-[10px] uppercase tracking-wider ${tc.textMuted}`}>Minimum</div>
            <div className={`text-xs font-semibold ${tc.text} mt-0.5`}>No minimum</div>
          </div>
          <div className={`rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-3 py-2.5`}>
            <div className={`text-[10px] uppercase tracking-wider ${tc.textMuted}`}>Deposit fee</div>
            <div className={`text-xs font-semibold ${tc.text} mt-0.5`}>Free</div>
          </div>
          <div className={`rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-3 py-2.5`}>
            <div className={`text-[10px] uppercase tracking-wider ${tc.textMuted}`}>Network</div>
            <div className={`text-xs font-semibold ${tc.text} mt-0.5 truncate`}>{chainLabel(chn) || '—'}</div>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

// ── Virtual-account "letter" sheet ──────────────────────────────────────────
function pickDeposit(details: any) {
  const root = details?.account_details ?? details ?? {};
  const srcDep = root?.source_deposit_instructions ?? root?.deposit_instructions ?? {};
  const bridgeRaw = root?.bridge_response ?? {};
  const bridgeData = bridgeRaw?.data ?? bridgeRaw ?? {};
  const bridgeDep = bridgeData?.source_deposit_instructions ?? {};
  const d = {
    ...(bridgeData && typeof bridgeData === 'object' ? bridgeData : {}),
    ...(root && typeof root === 'object' ? root : {}),
    ...(bridgeDep && typeof bridgeDep === 'object' ? bridgeDep : {}),
    ...(srcDep && typeof srcDep === 'object' ? srcDep : {}),
  };
  const pickUrlDeep = (node: any, patterns: RegExp[]): string | null => {
    const visited = new Set<any>();
    const walk = (value: any): string | null => {
      if (!value || typeof value !== 'object') return null;
      if (visited.has(value)) return null;
      visited.add(value);
      for (const [k, v] of Object.entries(value)) {
        const key = String(k).toLowerCase();
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
          if (patterns.some((p) => p.test(key))) return v;
        }
      }
      for (const v of Object.values(value)) {
        if (typeof v === 'object' && v) {
          const found = walk(v);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(node);
  };

  const paymentInstructionsUrl =
    d.payment_instructions_pdf_url ||
    d.payment_instructions_url ||
    d.payment_instruction_pdf_url ||
    d.payment_instruction_url ||
    pickUrlDeep(d, [/payment.*instruction/, /instruction.*pdf/, /^instructions?$/]) ||
    null;
  const accountLetterUrl =
    d.account_letter_pdf_url ||
    d.account_letter_url ||
    d.bank_letter_pdf_url ||
    d.bank_letter_url ||
    pickUrlDeep(d, [/account.*letter/, /bank.*letter/, /proof.*account/]) ||
    null;
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
    paymentInstructionsUrl,
    accountLetterUrl,
  };
}

function normalizeHttpsUrl(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function AccountDetailSheet({ open, onClose, va }: {
  open: boolean; onClose: () => void;
  va: { currency: string; rail?: string | null; status?: string; account_details: any } | null;
}) {
  const tc = useThemeClasses();
  if (!va) return <Sheet open={open} onClose={onClose}><div /></Sheet>;
  const cur = String(va.currency).toUpperCase();
  const d = pickDeposit(va.account_details);
  const paymentInstructionsUrl = normalizeHttpsUrl(d.paymentInstructionsUrl);
  const accountLetterUrl = normalizeHttpsUrl(d.accountLetterUrl);
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

        {(paymentInstructionsUrl || accountLetterUrl) && (
          <div className={`rounded-2xl ${tc.bgAlt} border ${tc.cardBorder} p-3 mt-3`}>
            <p className={`text-[10px] uppercase tracking-[0.16em] font-semibold ${tc.textMuted} mb-2`}>
              Documents
            </p>
            <div className="space-y-2">
              {paymentInstructionsUrl && (
                <a
                  href={paymentInstructionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`block w-full text-center rounded-xl border ${tc.cardBorder} ${tc.hoverBg} px-3 py-2 text-xs font-semibold ${tc.text}`}
                >
                  Instructions
                </a>
              )}
              {accountLetterUrl && (
                <a
                  href={accountLetterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`block w-full text-center rounded-xl border ${tc.cardBorder} ${tc.hoverBg} px-3 py-2 text-xs font-semibold ${tc.text}`}
                >
                  Account letter
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
