/**
 * BorderPay Africa — Cards (locked)
 *
 * Card issuing is not enabled for this product yet. Keep a real locked
 * product boundary, but do not show preview card faces or active card controls.
 *
 * Header chrome (back / title) is owned by AppShell for top-level routes —
 * this screen renders body-only.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CreditCard, Lock, ShieldCheck, RefreshCw, List, SlidersHorizontal, Receipt, CheckCircle2 } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { backendAPI } from '../../utils/api/backendAPI';

interface CardsScreenProps {
  onBack: () => void;
}

export function CardsScreen({ onBack: _onBack }: CardsScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'controls' | 'activity'>('overview');
  const loadInFlightRef = useRef<Promise<void> | null>(null);

  const title       = (t as any)?.('cards.locked.title')    ?? 'Cards are locked';
  const subtitle    = (t as any)?.('cards.locked.subtitle') ?? 'Card issuing is not enabled for your account yet.';
  const sectionTitle = 'Cards';
  const canCreate = false;

  const cardTabs = useMemo(() => ([
    { id: 'overview' as const, label: 'Overview', icon: List },
    { id: 'controls' as const, label: 'Controls', icon: SlidersHorizontal },
    { id: 'activity' as const, label: 'Activity', icon: Receipt },
  ]), []);

  const loadProgramState = async (force = false) => {
    if (loadInFlightRef.current) {
      await loadInFlightRef.current;
      return;
    }
    const run = (async () => {
      if (force) setLoading(true);
      setMessage(null);
      try {
        const r: any = await backendAPI.cards.getProgramStatus();
        if (!r?.success && r?.code === 'cards_locked') {
          setMessage('Cards are visible but locked until BorderPay enables card access.');
          return;
        }
        if (!r?.success) {
          setMessage('Card status is temporarily unavailable.');
          return;
        }
      } catch {
        setMessage('Card status is temporarily unavailable.');
      } finally {
        if (force) setLoading(false);
      }
    })();
    loadInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (loadInFlightRef.current === run) loadInFlightRef.current = null;
    }
  };

  useEffect(() => {
    void loadProgramState(false);
    const onFocus = () => { void loadProgramState(false); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadProgramState(false);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-5 pb-10">
        {/* Section eyebrow (replaces the old duplicate top bar) */}
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
          {sectionTitle}
        </p>

        <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-5 sm:p-6 max-w-2xl`}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#C7FF00]/20 flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-6 h-6 text-[#C7FF00]" />
            </div>
            <div className="min-w-0">
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${tc.borderLight} ${tc.bgAlt} mb-3`}>
                <Lock className={`w-3 h-3 ${tc.textMuted}`} />
                <span className={`text-[10px] font-bold tracking-wider uppercase ${tc.textMuted}`}>Locked</span>
              </div>
              <h1 className={`text-2xl sm:text-3xl font-semibold ${tc.text} tracking-tight mb-2`}>
                {title}
              </h1>
              <p className={`text-sm ${tc.textMuted} leading-relaxed`}>
                {subtitle}
              </p>
              <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#C7FF00]/10 border border-[#C7FF00]/25">
                <CheckCircle2 className="w-3 h-3 text-[#C7FF00]" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#C7FF00]">Visa program readiness</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-3xl border border-[#C7FF00]/25 bg-black/60 overflow-hidden">
          <img
            src="/cards/IMG_2165.PNG"
            alt="BorderPay Visa card mockup"
            className="w-full h-auto object-cover"
            loading="lazy"
          />
        </div>

        <div className={`mt-5 rounded-2xl border ${tc.cardBorder} ${tc.card} p-2 flex items-center gap-2`}>
          {cardTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${active ? 'bg-[#C7FF00] text-black' : `${tc.textMuted} ${tc.hoverBg}`}`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 max-w-2xl">
          <h1 className={`text-2xl sm:text-3xl font-semibold ${tc.text} tracking-tight mb-2`}>
            No card can be issued yet
          </h1>
          <p className={`text-sm ${tc.textMuted} leading-relaxed`}>
            The card backend stays locked until BorderPay has live card access.
            This screen will connect to the card service once that access is
            approved; until then it cannot create, fund, freeze, or manage cards.
          </p>
          {message && (
            <p className={`mt-2 text-xs ${tc.textMuted}`}>{message}</p>
          )}

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              disabled={!canCreate}
              aria-disabled="true"
              className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border ${tc.cardBorder} ${tc.textMuted} cursor-not-allowed`}
            >
              <Lock className="w-4 h-4" />
              <span className="text-xs font-semibold">Create card</span>
            </button>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border ${tc.cardBorder} ${tc.textMuted} cursor-not-allowed`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="text-xs font-semibold">Spending controls</span>
            </button>
            <button
              type="button"
              onClick={() => { void loadProgramState(true); }}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border ${tc.cardBorder} ${tc.textMuted} ${tc.hoverBg}`}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="text-xs font-semibold">Refresh status</span>
            </button>
          </div>

          <ul className={`mt-8 space-y-2.5 text-sm ${tc.textSecondary}`}>
            <li className="flex items-start gap-2">
              <Lock className="w-4 h-4 mt-0.5 text-[#C7FF00] flex-shrink-0" />
              <span>Cards remain locked for both Individual and Business users.</span>
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 mt-0.5 text-[#C7FF00] flex-shrink-0" />
              <span>Card backend endpoints are fail-closed until BorderPay enables the program.</span>
            </li>
            <li className="flex items-start gap-2">
              <Receipt className="w-4 h-4 mt-0.5 text-[#C7FF00] flex-shrink-0" />
              <span>Card transactions/statements UI remains present but locked for now.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default CardsScreen;
