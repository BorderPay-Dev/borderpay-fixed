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
  const subtitle    = (t as any)?.('cards.coming_soon.subtitle') ?? 'Spend your USD balance anywhere Mastercard is accepted — coming with the next release.';
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
        {/*
            Card faces: real BorderPay logo top-left as the HERO (white), EMV
            chip middle-right, Mastercard mark bottom-right, "Soon" lock pill
            top-right. Two colourways (lime-on-black + green-on-black), both
            Mastercard. Cards remain Coming Soon — no active issuing implied. */}
        <div className="flex flex-col sm:flex-row gap-4 max-w-2xl">
          {[
            {
              key: 'visa' as const,
              gradient:
                'radial-gradient(120% 90% at 8% 16%,rgba(199,255,0,.16),transparent 42%),radial-gradient(140% 120% at 92% 90%,rgba(199,255,0,.10),transparent 46%),linear-gradient(150deg,#0a0d0a,#15191a 48%,#0a0c0b)',
              ring: 'rgba(199,255,0,.18)',
            },
            {
              key: 'mc' as const,
              gradient:
                'radial-gradient(120% 90% at 8% 16%,rgba(0,200,140,.18),transparent 42%),radial-gradient(140% 120% at 92% 90%,rgba(0,200,140,.10),transparent 46%),linear-gradient(150deg,#06120d,#0c1a16 48%,#06100c)',
              ring: 'rgba(0,200,140,.20)',
            },
          ].map((c, i) => (
            <motion.div
              key={c.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.06, ease: 'easeOut' }}
              className="relative overflow-hidden rounded-3xl aspect-[1.586/1] flex-1 min-w-0"
              style={{ background: c.gradient, boxShadow: `inset 0 0 0 1px ${c.ring}, 0 18px 40px -18px ${c.ring}` }}
              aria-hidden="true"
            >
              {/* Lock "Soon" pill — top-right */}
              <div className="absolute top-4 right-4 z-20 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/45 border border-white/15 backdrop-blur-sm">
                <Lock className="w-3 h-3 text-white" />
                <span className="text-[9px] font-bold tracking-wider uppercase text-white">Soon</span>
              </div>

              {/* HERO: real BorderPay logo (white) — top-left, largest mark */}
              <span
                className="absolute top-4 left-5 z-10 block"
                style={{
                  width: '60%',
                  height: 56,
                  backgroundColor: '#fff',
                  WebkitMaskImage: "url('/borderpay-mark.svg')",
                  maskImage: "url('/borderpay-mark.svg')",
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'left center',
                  maskPosition: 'left center',
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                }}
              />

              {/* EMV chip — middle-right, vertically centred */}
              <div
                className="absolute right-5 top-1/2 -translate-y-1/2 z-10 rounded-md"
                style={{
                  width: 46,
                  height: 34,
                  background: 'linear-gradient(135deg,#d9c98a,#b8a45e 45%,#efe3ad 60%,#a8965a)',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,.5)',
                }}
              >
                <div
                  className="absolute rounded-[3px]"
                  style={{ inset: '5px 7px', border: '1px solid rgba(80,60,20,.5)' }}
                />
              </div>

              {/* Bottom row — VIRTUAL eyebrow + network mark */}
              <div className="absolute left-5 right-5 bottom-5 z-10 flex items-end justify-between">
                <span className="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/55">
                  Virtual
                </span>
                {/* Mastercard interlocking circles on BOTH cards (no Visa). */}
                <div className="flex -space-x-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#EB001B]" />
                  <span
                    className="w-6 h-6 rounded-full"
                    style={{ background: 'radial-gradient(circle at 30% 50%,#FF5F00 0 40%,#F79E1B 60%)' }}
                  />
                </div>
              </div>
            </motion.div>
          ))}
        </div>

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
              <span>Spend anywhere Mastercard is accepted, in any currency</span>
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
