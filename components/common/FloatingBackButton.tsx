/**
 * FloatingBackButton — a floating glass "back" chip, matching the AppShell
 * header chips (burger / notifications / profile). Fixed top-left, overlays the
 * scrolling content, and respects the iOS/Android safe-area so it never sits too
 * high under the status bar on PWA / standalone.
 *
 * Usage: render once near the top of a standalone screen and give the screen's
 * content enough top padding (≈ safe-area + 64px) so the first row clears the
 * chip — `pt-floating-back` (or an inline calc) does this.
 */

import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

export function FloatingBackButton({
  onBack,
  label = 'Back',
  position = 'fixed',
}: {
  onBack: () => void;
  label?: string;
  position?: 'fixed' | 'relative';
}) {
  const tc = useThemeClasses();
  const wrapperClass = position === 'relative'
    ? 'relative z-40 pointer-events-none'
    : 'fixed top-0 left-0 z-40 px-3 pointer-events-none';
  const wrapperStyle = position === 'relative'
    ? undefined
    : { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' };
  return (
    <div
      className={wrapperClass}
      style={wrapperStyle}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label={label}
        className={`pointer-events-auto w-11 h-11 flex items-center justify-center rounded-full border ${tc.borderLight} ${tc.headerBg} backdrop-blur-2xl shadow-[0_10px_30px_rgba(0,0,0,0.30)] ${tc.hoverBg} transition-colors active:scale-95`}
      >
        <ArrowLeft className={`w-5 h-5 ${tc.text}`} />
      </button>
    </div>
  );
}

export default FloatingBackButton;
