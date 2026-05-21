/**
 * Geographic restrictions screen (kept under the "card-restrictions" route
 * name for caller compatibility; surfaces partner country eligibility, not
 * card-network restrictions specifically).
 *
 * Replaces the old card-network-restriction list with the live partner
 * country eligibility policy. Users in "coming-soon" countries can sign
 * up but cannot provision a USD virtual account or a stablecoin wallet
 * until our African local-rails partner is wired.
 *
 * AppShell owns the top chrome; renders body-only.
 */

import React from 'react';
import { motion } from 'motion/react';
import { Globe, Info } from 'lucide-react';
import { PROHIBITED_COUNTRY_ENTRIES } from '../../utils/compliance/partnerCountryPolicy';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface CardRestrictionsScreenProps {
  onBack: () => void;
}

export function CardRestrictionsScreen({ onBack }: CardRestrictionsScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-5 pb-10">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
          {tt('cards.geoRestrictions', 'Geographic eligibility')}
        </p>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3.5 flex items-start gap-3 mb-5`}
        >
          <Globe className="w-4 h-4 text-[#C7FF00] mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${tc.text}`}>
              Where our products are available
            </p>
            <p className={`text-[11px] ${tc.textMuted} mt-0.5 leading-snug`}>
              Account signup is open across Africa. USD virtual accounts and
              stablecoin wallets follow our regulated banking partner's
              country eligibility. Countries below are coming online through
              a future local-rails partner.
            </p>
          </div>
        </motion.div>

        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          Not currently supported ({PROHIBITED_COUNTRY_ENTRIES.length})
        </h2>
        <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
          {PROHIBITED_COUNTRY_ENTRIES.map((c, i) => {
            const isComingSoon = c.status === 'coming-soon';
            const badgeText    = isComingSoon ? 'Soon' : 'Restricted';
            const badgeClass   = isComingSoon
              ? 'bg-amber-500/15 text-amber-300'
              : 'bg-red-500/15 text-red-300';
            return (
              <div
                key={c.code}
                className={`px-4 py-3.5 flex items-start gap-3 ${i > 0 ? `border-t ${tc.borderLight}` : ''}`}
              >
                <div className={`w-9 h-9 rounded-full ${tc.bgAlt} flex items-center justify-center flex-shrink-0 font-mono text-[11px] font-bold ${tc.text}`}>
                  {c.code}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${tc.text}`}>{c.name}</p>
                  {c.reason && (
                    <p className={`text-[11px] ${tc.textMuted} mt-0.5 leading-snug`}>
                      {c.reason}
                    </p>
                  )}
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${badgeClass} flex-shrink-0`}>{badgeText}</span>
              </div>
            );
          })}
        </div>

        <div className={`mt-5 flex items-start gap-2 px-4 py-3 rounded-xl border ${tc.borderLight} ${tc.card}`}>
          <Info className={`w-3.5 h-3.5 mt-0.5 ${tc.textMuted} flex-shrink-0`} />
          <p className={`text-[11px] ${tc.textMuted} leading-snug`}>
            Eligibility may change as our partner expands coverage and as
            local regulations evolve. We'll email affected accounts when
            their country becomes available.
          </p>
        </div>

        <button
          onClick={onBack}
          className={`mt-6 text-[11px] font-semibold ${tc.textMuted} hover:${tc.text}`}
        >
          Back
        </button>
      </div>
    </div>
  );
}

export default CardRestrictionsScreen;
