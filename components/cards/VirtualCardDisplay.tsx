/**
 * BorderPay Africa - Virtual Card Display (v2)
 * Reimagined card face. Keeps every piece of data the old design exposed:
 *   • Masked card number (••••  ••••  ••••  1234)
 *   • Cardholder name
 *   • Expiry MM/YY
 *   • Network brand (VISA / Mastercard)
 *   • Balance overlay
 *   • Status chip (Active / Frozen / Terminated)
 * Adds: EMV chip, contactless mark, subtle holographic shine band,
 *       neon-lined status pill, ambient corner glow. No functional changes.
 */

import React from 'react';
import type { CardDesign } from './CardDesignSelector';
import { BorderPayLogo } from './BorderPayLogo';

interface VirtualCard {
  id: string;
  cardNumber: string;
  cvv: string;
  expiryMonth: string;
  expiryYear: string;
  cardholderName: string;
  design: CardDesign;
  status: 'active' | 'frozen' | 'terminated';
  balance: number;
  currency: string;
  brand: string;
}

interface VirtualCardDisplayProps {
  card: VirtualCard;
}

/** Convert Tailwind gradient classes to CSS linear-gradient (fallback). */
function ensureGradientCSS(gradient: string): string {
  if (gradient.startsWith('linear-gradient')) return gradient;
  const fromMatch = gradient.match(/from-\[([^\]]+)\]/);
  const viaMatch = gradient.match(/via-\[([^\]]+)\]/);
  const toMatch = gradient.match(/to-\[([^\]]+)\]/);
  const from = fromMatch?.[1] || '#1a1a2e';
  const via = viaMatch?.[1];
  const to = toMatch?.[1] || '#0f3460';
  if (via) return `linear-gradient(135deg, ${from} 0%, ${via} 50%, ${to} 100%)`;
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}

// Two-tone EMV chip drawn in SVG so it scales cleanly on any gradient.
function EmvChip({ tone = 'gold' }: { tone?: 'gold' | 'silver' }) {
  const base = tone === 'gold' ? '#E8C66A' : '#C8CCD2';
  const edge = tone === 'gold' ? '#9A7A2E' : '#6B7079';
  return (
    <svg width="34" height="26" viewBox="0 0 34 26" aria-hidden>
      <defs>
        <linearGradient id="chip-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={base} stopOpacity="0.95" />
          <stop offset="55%" stopColor={base} stopOpacity="0.75" />
          <stop offset="100%" stopColor={edge} stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="33" height="25" rx="4.5" fill="url(#chip-face)" stroke={edge} strokeOpacity="0.6" />
      {/* chip traces */}
      <g stroke={edge} strokeOpacity="0.55" strokeWidth="0.8" fill="none">
        <path d="M0 8 H12" />
        <path d="M0 18 H12" />
        <path d="M34 8 H22" />
        <path d="M34 18 H22" />
        <rect x="12" y="5" width="10" height="16" rx="1.2" stroke={edge} strokeOpacity="0.75" />
        <path d="M17 5 V21" />
      </g>
    </svg>
  );
}

// Contactless wave glyph.
function ContactlessMark({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <g fill="none" stroke={color} strokeLinecap="round" strokeWidth="1.6">
        <path d="M5 5.5 C 7.5 8.25, 7.5 9.75, 5 12.5" opacity="0.95" />
        <path d="M8 3.5 C 12, 7.5, 12, 10.5, 8 14.5" opacity="0.7" />
        <path d="M11 2 C 16, 6.5, 16, 11.5, 11 16" opacity="0.45" />
      </g>
    </svg>
  );
}

function formatCardNumber(raw: string): string {
  // Keep any grouping the source already has; otherwise render the last four
  // with mask groups in front so the layout mirrors a real card face.
  const cleaned = (raw || '').replace(/\s+/g, '');
  if (cleaned.length >= 16) {
    return cleaned.replace(/(.{4})/g, '$1  ').trim();
  }
  const last4 = (cleaned || '0000').slice(-4);
  return `••••  ••••  ••••  ${last4}`;
}

export function VirtualCardDisplay({ card }: VirtualCardDisplayProps) {
  const isFrozen = card.status === 'frozen';
  const isTerminated = card.status === 'terminated';
  const isDark = card.design.textColor === 'light' || card.design.textColor === 'text-white';
  const isMastercard = card.brand?.toUpperCase() === 'MASTERCARD';
  const isGold = card.design.id === 'aurora-gold';
  const accent = card.design.accentColor || '#C7FF00';
  const decorColor = (card.design as any).decorColor || 'rgba(199,255,0,0.08)';
  const glassOverlay = (card.design as any).glassOverlay || '';

  const primary = isDark ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.88)';
  const secondary = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
  const muted = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.4)';
  const hair = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';

  const statusTone = isFrozen
    ? { label: 'Frozen', fg: '#93C5FD', bg: 'rgba(59,130,246,0.18)', ring: 'rgba(147,197,253,0.35)' }
    : isTerminated
    ? { label: 'Terminated', fg: '#FCA5A5', bg: 'rgba(239,68,68,0.18)', ring: 'rgba(252,165,165,0.35)' }
    : { label: 'Active', fg: accent,       bg: 'rgba(199,255,0,0.12)', ring: `${accent}55` };

  const expiry = `${card.expiryMonth || '01'}/${(card.expiryYear || '2027').toString().slice(-2)}`;
  const formatted = formatCardNumber(card.cardNumber);

  return (
    <div>
      <div
        className={`relative rounded-[22px] overflow-hidden ${isFrozen ? 'opacity-70 saturate-50' : ''} ${isTerminated ? 'opacity-45 grayscale' : ''}`}
        style={{
          aspectRatio: '1.586 / 1',
          background: ensureGradientCSS(card.design.gradient),
          boxShadow: `0 20px 48px -18px ${decorColor}, 0 6px 18px rgba(0,0,0,0.45)`,
        }}
      >
        {/* Glass overlay */}
        {glassOverlay && <div className="absolute inset-0" style={{ background: glassOverlay }} />}

        {/* Hairline inset border on dark cards */}
        {isDark && (
          <div
            className="absolute inset-0 rounded-[22px] pointer-events-none"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
          />
        )}

        {/* Holographic shine band */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.06) 48%, rgba(255,255,255,0.12) 52%, rgba(255,255,255,0.06) 56%, transparent 70%)',
          }}
        />

        {/* Ambient corner glow */}
        <div
          className="absolute -top-16 -right-16 w-52 h-52 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, ${decorColor} 0%, transparent 70%)` }}
        />
        <div
          className="absolute -bottom-20 -left-16 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, ${decorColor} 0%, transparent 72%)`, opacity: 0.7 }}
        />

        {/* Content grid */}
        <div className="relative h-full p-5 flex flex-col justify-between z-10">
          {/* Top: logo + status */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <BorderPayLogo color={isDark ? '#ffffff' : '#000000'} size={34} />
              <span
                className="text-[9px] uppercase tracking-[0.22em] font-bold"
                style={{ color: secondary }}
              >
                BorderPay
              </span>
            </div>
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full backdrop-blur-md"
              style={{
                background: statusTone.bg,
                boxShadow: `inset 0 0 0 1px ${statusTone.ring}`,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusTone.fg }} />
              <span className="text-[9px] uppercase tracking-[0.18em] font-bold" style={{ color: statusTone.fg }}>
                {statusTone.label}
              </span>
            </div>
          </div>

          {/* Middle: chip + contactless + balance */}
          <div className="flex items-center justify-between -mt-1">
            <div className="flex items-center gap-3">
              <EmvChip tone={isGold ? 'gold' : 'silver'} />
              <ContactlessMark color={secondary} />
            </div>
            <div className="text-right">
              <p
                className="font-semibold"
                style={{ fontSize: 8, color: muted, textTransform: 'uppercase', letterSpacing: '0.18em' }}
              >
                Balance
              </p>
              <p className="text-[15px] font-bold leading-tight tabular-nums" style={{ color: accent }}>
                ${card.balance.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Card number */}
          <div className="select-none">
            <p
              className="font-mono tracking-[0.12em] tabular-nums"
              style={{
                color: primary,
                fontSize: 'clamp(16px, 4.6vw, 20px)',
                fontWeight: 600,
                textShadow: isDark ? '0 1px 2px rgba(0,0,0,0.35)' : 'none',
              }}
            >
              {formatted}
            </p>
          </div>

          {/* Bottom: cardholder / expiry / brand */}
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p
                className="font-semibold"
                style={{ fontSize: 8, color: muted, textTransform: 'uppercase', letterSpacing: '0.18em' }}
              >
                Cardholder
              </p>
              <p
                className="text-[11px] font-bold uppercase tracking-[0.08em] truncate"
                style={{ color: primary }}
              >
                {card.cardholderName || 'BorderPay User'}
              </p>
            </div>
            <div className="shrink-0 text-right" style={{ paddingRight: 6, borderRight: `1px solid ${hair}`, marginRight: 10 }}>
              <p
                className="font-semibold"
                style={{ fontSize: 8, color: muted, textTransform: 'uppercase', letterSpacing: '0.18em' }}
              >
                Expires
              </p>
              <p className="text-[11px] font-bold tabular-nums" style={{ color: primary }}>
                {expiry}
              </p>
            </div>
            <div className="shrink-0">
              {isMastercard ? (
                <div className="flex -space-x-2">
                  <div className="w-7 h-7 rounded-full bg-[#EB001B] opacity-90" />
                  <div className="w-7 h-7 rounded-full bg-[#F79E1B] opacity-90" />
                </div>
              ) : (
                <span
                  className="italic font-black tracking-[0.04em]"
                  style={{
                    fontSize: 18,
                    color: isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.78)',
                    fontFamily: "'Times New Roman', Georgia, serif",
                  }}
                >
                  VISA
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
