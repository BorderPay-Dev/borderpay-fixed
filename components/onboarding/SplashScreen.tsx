import React, { useEffect } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

// P0 runtime-safe splash:
// - no motion library
// - no icon package
// - no external component dependency
// This guarantees branding renders even under partial bundle degradation.
export function SplashScreen({ onComplete }: SplashScreenProps) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onComplete();
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-[9998] flex flex-col items-center justify-center bg-[#0B0E11]">
      <div className="mb-7 animate-pulse">
        <div className="w-[170px] h-[170px] rounded-full bg-[#C7FF00] flex items-center justify-center shadow-[0_20px_60px_rgba(199,255,0,0.30)]">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 110" width="78" height="108" aria-label="BorderPay">
            <rect x="10" y="5" width="24" height="95" rx="12" fill="#000000" />
            <path d="M38 33 A33.5 33.5 0 0 1 38 100 Z" fill="#000000" />
            <circle cx="66" cy="16" r="8" fill="none" stroke="#000000" strokeWidth="1.8" />
            <text x="66" y="20.5" textAnchor="middle" fontSize="12" fontWeight="bold" fontFamily="Arial, sans-serif" fill="#000000">R</text>
          </svg>
        </div>
      </div>

      <p className="text-[13px] text-[#8B98A8] font-medium tracking-[0.06em]">Securing session</p>
      <div className="mt-2.5 h-5 w-5 rounded-full border-2 border-[#1A1A1A] border-t-[#C7FF00] animate-spin" />
    </div>
  );
}

