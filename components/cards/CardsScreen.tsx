/**
 * BorderPay Africa — Cards (Coming Soon)
 *
 * Card issuance is intentionally disabled across the product. The screen
 * exists so existing nav/links don't 404 and surfaces a Revolut-style
 * "card preview + coming soon" hero. Do not re-introduce fund / freeze /
 * terminate paths without a product decision.
 *
 * Header chrome (back / title) is owned by AppShell for top-level routes —
 * this screen renders body-only.
 */

import React from 'react';
import { motion } from 'motion/react';
import { CreditCard, Bell, Sparkles, Lock } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface CardsScreenProps {
  onBack: () => void;
}

export function CardsScreen({ onBack: _onBack }: CardsScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  const title       = (t as any)?.('cards.coming_soon.title')    ?? 'Virtual cards, soon';
  const subtitle    = (t as any)?.('cards.coming_soon.subtitle') ?? 'Spend your USD balance anywhere Visa is accepted — coming with the next release.';
  const notifyMe    = (t as any)?.('cards.coming_soon.notify')   ?? 'Notify me at launch';
  const sectionTitle = 'Cards';

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-5 pb-10">
        {/* Section eyebrow (replaces the old duplicate top bar) */}
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
          {sectionTitle}
        </p>

        {/* ── Card preview ──
            A faux virtual card with brand mark + obfuscated number + "Coming
            soon" lock badge. Subtle lime sheen across the top edge. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#15191F] via-[#0F1216] to-[#0B0E11] aspect-[1.586/1] max-w-md"
          aria-hidden="true"
        >
          {/* Lime sheen */}
          <div className="pointer-events-none absolute -top-20 -right-10 w-48 h-48 rounded-full bg-[#C7FF00] opacity-[0.12] blur-3xl" />

          {/* Lock chip */}
          <div className="absolute top-5 right-5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 border border-white/10 backdrop-blur-sm">
            <Lock className="w-3 h-3 text-[#C7FF00]" />
            <span className="text-[10px] font-bold tracking-wider uppercase text-[#C7FF00]">Soon</span>
          </div>

          {/* Brand mark */}
          <div className="absolute top-5 left-5 inline-flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-[#C7FF00] flex items-center justify-center">
              <span className="text-black font-black text-[11px]">BP</span>
            </div>
            <span className="text-white/80 text-[11px] font-semibold tracking-wider uppercase">
              BorderPay
            </span>
          </div>

          {/* Obfuscated number */}
          <p className="absolute left-5 bottom-12 text-white/70 font-mono text-base tracking-[0.18em] tabular-nums">
            •••• •••• •••• ••••
          </p>

          {/* Footer row */}
          <div className="absolute left-5 right-5 bottom-4 flex items-end justify-between">
            <div>
              <p className="text-[8px] uppercase tracking-wider text-white/40">Card holder</p>
              <p className="text-[11px] font-semibold text-white/80">Coming soon</p>
            </div>
            <div className="text-right">
              <p className="text-[8px] uppercase tracking-wider text-white/40">Expires</p>
              <p className="text-[11px] font-semibold text-white/80 font-mono">••/••</p>
            </div>
          </div>
        </motion.div>

        {/* ── Copy + notify ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08, ease: 'easeOut' }}
          className="mt-7 max-w-md"
        >
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#C7FF00]/15 mb-3">
            <Sparkles className="w-3 h-3 text-[#C7FF00]" />
            <span className="text-[10px] font-bold tracking-wider uppercase text-[#C7FF00]">In the works</span>
          </div>
          <h1 className={`text-2xl sm:text-3xl font-semibold ${tc.text} tracking-tight mb-2`}>
            {title}
          </h1>
          <p className={`text-sm ${tc.textMuted} leading-relaxed`}>
            {subtitle}
          </p>

          <button
            type="button"
            disabled
            aria-disabled="true"
            className={`mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full border ${tc.cardBorder} ${tc.textMuted} cursor-not-allowed`}
          >
            <Bell className="w-4 h-4" />
            <span className="text-sm font-medium">{notifyMe}</span>
          </button>

          {/* Feature peek */}
          <ul className={`mt-8 space-y-2.5 text-sm ${tc.textSecondary}`}>
            <li className="flex items-start gap-2">
              <CreditCard className="w-4 h-4 mt-0.5 text-[#C7FF00] flex-shrink-0" />
              <span>Virtual cards funded from your USD balance</span>
            </li>
            <li className="flex items-start gap-2">
              <CreditCard className="w-4 h-4 mt-0.5 text-[#C7FF00] flex-shrink-0" />
              <span>Spend anywhere Visa is accepted, in any currency</span>
            </li>
            <li className="flex items-start gap-2">
              <CreditCard className="w-4 h-4 mt-0.5 text-[#C7FF00] flex-shrink-0" />
              <span>Freeze, unfreeze, or terminate in one tap</span>
            </li>
          </ul>
        </motion.div>
      </div>
    </div>
  );
}

export default CardsScreen;
