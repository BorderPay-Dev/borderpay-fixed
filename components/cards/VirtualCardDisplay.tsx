/**
 * BorderPay Africa - Virtual Card Display
 * Clean minimal card face inspired by modern fintech cards:
 * BorderPay logo (top-left), status badge (top-right),
 * 3 dots (bottom-left), last 4 digits (center), VISA/MC brand (bottom-right).
 * Balance overlay, glass overlay + decorative ambient glow for ultra-modern look.
 * Design-only — no functional changes.
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

/** Convert Tailwind gradient classes to CSS linear-gradient (fallback) */
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

export function VirtualCardDisplay({ card }: VirtualCardDisplayProps) {
  const isFrozen = card.status === 'frozen';
  const isTerminated = card.status === 'terminated';
  const last4 = card.cardNumber.slice(-4);
  const isDark = card.design.textColor === 'light' || card.design.textColor === 'text-white';
  const isMastercard = card.brand?.toUpperCase() === 'MASTERCARD';
  const isGold = card.design.id === 'aurora-gold';
  const accent = card.design.accentColor || '#C7FF00';
  const decorColor = (card.design as any).decorColor || 'rgba(199,255,0,0.06)';
  const glassOverlay = (card.design as any).glassOverlay || '';

  const numColor = isDark ? (isGold ? '#FFD700' : '#C7FF00') : 'rgba(0,0,0,0.85)';
  const textSecondary = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.4)';

  return (
    <div>
      <div
        className={`relative rounded-2xl overflow-hidden ${
          isFrozen ? 'opacity-60 saturate-50' : ''
        } ${isTerminated ? 'opacity-40 grayscale' : ''}`}
        style={{
          aspectRatio: '1.586/1',
          background: ensureGradientCSS(card.design.gradient),
          boxShadow: `0 8px 32px -4px ${decorColor}, 0 2px 12px rgba(0,0,0,0.5)`,
        }}
      >
        {/* Glass overlay */}
        {glassOverlay && (
          <div className="absolute inset-0" style={{ background: glassOverlay }} />
        )}

        {/* Inset border for dark cards */}
        {isDark && (
          <div
            className="absolute inset-0 rounded-2xl pointer-events-none"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
          />
        )}

        {/* Decorative ambient glow circle */}
        <div
          className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${decorColor} 0%, transparent 70%)`,
          }}
        />

        {/* Card Content */}
        <div className="relative h-full p-5 flex flex-col justify-between z-10">
          {/* Top Row: BorderPay logo (big) + Status */}
          <div className="flex items-start justify-between">
            <BorderPayLogo
              color={isDark ? '#ffffff' : '#000000'}
              size={52}
            />
            <div className="flex items-center gap-2">
              {isFrozen && (
                <span className="text-[9px] uppercase tracking-[0.15em] font-bold text-blue-300 bg-blue-500/20 backdrop-blur-sm px-2 py-0.5 rounded-full border border-blue-400/20">
                  Frozen
                </span>
              )}
              {isTerminated && (
                <span className="text-[9px] uppercase tracking-[0.15em] font-bold text-red-300 bg-red-500/20 backdrop-blur-sm px-2 py-0.5 rounded-full border border-red-400/20">
                  Terminated
                </span>
              )}
            </div>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Bottom Row: Network brand only (smaller than BP logo) */}
          <div className="flex items-end justify-end">
            {isMastercard ? (
              <div className="flex -space-x-2">
                <div className="w-7 h-7 rounded-full bg-[#EB001B] opacity-85" />
                <div className="w-7 h-7 rounded-full bg-[#F79E1B] opacity-85" />
              </div>
            ) : (
              <span
                className="text-lg font-black tracking-wider"
                style={{ color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)' }}
              >
                VISA
              </span>
            )}
          </div>
        </div>

        {/* Balance overlay */}
        <div className="absolute top-5 right-5 text-right z-20" style={{ marginTop: '30px' }}>
          <p style={{ fontSize: 8, color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.15em' }}>
            Balance
          </p>
          <p className="text-sm font-bold" style={{ color: accent }}>
            ${card.balance.toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  );
}