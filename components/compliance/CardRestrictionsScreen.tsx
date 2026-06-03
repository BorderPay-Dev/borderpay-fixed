/**
 * Geographic restrictions screen (kept under the "card-restrictions" route
 * name for caller compatibility; surfaces partner country eligibility, not
 * card-network restrictions specifically).
 *
 * Renders the three Bridge-restricted tiers as separate sections so the
 * copy doesn't conflate sanctions / commercial-unavailability with the
 * future-state "coming via local-rails partner" plan. Round-10 P2 fix.
 *
 * Round-11 P2 follow-up (Issue #4 item 3): the three sections now share
 * a single Section helper that accepts an optional leading icon. The
 * previous version used the helper for one section and inlined two
 * near-identical copies for the others; that's collapsed here.
 *
 * AppShell owns the top chrome; renders body-only.
 */

import React from 'react';
import { motion } from 'motion/react';
import { Globe, Info, ShieldOff, Ban } from 'lucide-react';
import {
  COMING_SOON_COUNTRIES,
  SANCTIONED_COUNTRY_ENTRIES,
  UNAVAILABLE_COUNTRY_ENTRIES,
  type PartnerCountryEntry,
} from '../../utils/compliance/partnerCountryPolicy';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface CardRestrictionsScreenProps {
  onBack: () => void;
}

interface SectionProps {
  title:     string;
  subtitle:  string;
  /** Optional leading icon for the section heading. */
  icon?:     React.ComponentType<{ className?: string }>;
  /** Tailwind colour class for the icon stroke (e.g. 'text-red-400'). */
  iconColor?: string;
  entries:   readonly PartnerCountryEntry[];
  badge:     { text: string; classes: string };
}

export function CardRestrictionsScreen({ onBack }: CardRestrictionsScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  function Section({ title, subtitle, icon: Icon, iconColor, entries, badge }: SectionProps) {
    if (entries.length === 0) return null;
    const headingClasses = `text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`;
    return (
      <div className="mb-6">
        {Icon ? (
          <div className="flex items-center gap-2 mb-1 px-1">
            <Icon className={`w-3 h-3 ${iconColor ?? ''}`} />
            <h2 className={headingClasses}>{title} ({entries.length})</h2>
          </div>
        ) : (
          <h2 className={`${headingClasses} mb-1 px-1`}>{title} ({entries.length})</h2>
        )}
        <p className={`text-[11px] ${tc.textMuted} mb-2.5 px-1 leading-snug`}>{subtitle}</p>
        <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
          {entries.map((c, i) => (
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
                  <p className={`text-[11px] ${tc.textMuted} mt-0.5 leading-snug`}>{c.reason}</p>
                )}
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${badge.classes} flex-shrink-0`}>
                {badge.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-5 pb-10">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
          {tt('cards.geoRestrictions', 'Geographic eligibility')}
        </p>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3.5 flex items-start gap-3 mb-6`}
        >
          <Globe className="w-4 h-4 text-[#C7FF00] mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${tc.text}`}>
              Where our products are available
            </p>
            <p className={`text-[11px] ${tc.textMuted} mt-0.5 leading-snug`}>
              Account signup is open across Africa. USD virtual accounts and
              stablecoin wallets follow our regulated banking partner's
              country eligibility. The sections below explain why specific
              jurisdictions are not currently supported and which ones we
              expect to bring online through a future local-rails partner.
            </p>
          </div>
        </motion.div>

        {/* Section 1: Coming soon via local-rails partner (DRC only).
            No icon — this is the most "promising" tier. */}
        <Section
          title="Coming soon via local-rails partner"
          subtitle="These countries will come online once our African local-rails partner is wired up. Signup is allowed; partner-backed products are not yet provisioned."
          entries={COMING_SOON_COUNTRIES}
          badge={{ text: 'Soon', classes: 'bg-amber-500/15 text-amber-300' }}
        />

        {/* Section 2: Not currently serviceable (commercial / regulatory). */}
        <Section
          title="Not currently serviceable"
          subtitle="Our regulated banking partner does not currently facilitate any payment rail for residents of these jurisdictions. This is a commercial / regulatory restriction, not a sanctions designation."
          icon={Ban}
          iconColor="text-orange-400"
          entries={UNAVAILABLE_COUNTRY_ENTRIES}
          badge={{ text: 'Unavailable', classes: 'bg-orange-500/15 text-orange-300' }}
        />

        {/* Section 3: Sanctioned (regulatory / OFAC-style). Distinct copy
            from "coming soon" — these are NOT coming soon. */}
        <Section
          title="Restricted"
          subtitle="These jurisdictions are subject to international sanctions and we cannot onboard residents under any product tier."
          icon={ShieldOff}
          iconColor="text-red-400"
          entries={SANCTIONED_COUNTRY_ENTRIES}
          badge={{ text: 'Restricted', classes: 'bg-red-500/15 text-red-300' }}
        />

        <div className={`flex items-start gap-2 px-4 py-3 rounded-xl border ${tc.borderLight} ${tc.card}`}>
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
