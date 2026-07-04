import { BorderPayLogo } from '../cards/BorderPayLogo';
/**
 * BorderPay Africa - Splash Screen
 * 2.5-second delay with pulsing logo animation
 * Shows official app icon on circular lime green background
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';

interface SplashScreenProps {
  onComplete: () => void;
}

function SafeBrandLogo() {
  try {
    return <BorderPayLogo size={80} color="#000000" />;
  } catch {
    // Regression hardening: if logo component render fails, keep branded splash alive.
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 110" width="80" height="110" aria-label="BorderPay">
        <rect x="10" y="5" width="24" height="95" rx="12" fill="#000000" />
        <path d="M38 33 A33.5 33.5 0 0 1 38 100 Z" fill="#000000" />
        <circle cx="66" cy="16" r="8" fill="none" stroke="#000000" strokeWidth="1.8" />
        <text x="66" y="20.5" textAnchor="middle" fontSize="12" fontWeight="bold" fontFamily="Arial, sans-serif" fill="#000000">R</text>
      </svg>
    );
  }
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => {
        onComplete();
      }, 500);
    }, 2500);

    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0B0E11]"
      initial={{ opacity: 1 }}
      animate={{ opacity: isExiting ? 0 : 1 }}
      transition={{ duration: 0.5 }}
    >
      {/* Animated gradient background */}
      <div className="glass-gradient-bg" />
      <div className="glass-noise-overlay" />

      {/* Logo with Pulsing Animation */}
      <motion.div
        animate={{
          scale: [1, 1.05, 1],
          opacity: [1, 0.9, 1],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        className="mb-8 relative z-[2]"
      >
        {/* Circular Lime Green Background */}
        <div className="w-[180px] h-[180px] rounded-full bg-[#C7FF00] flex items-center justify-center shadow-2xl">
          {/* Official App Icon (geometric b logo) */}
          <div className="w-[100px] h-[110px] flex items-center justify-center">
            <SafeBrandLogo />
          </div>
        </div>
      </motion.div>

      {/* Subtext */}
      <p className="bp-text-label text-gray-400 relative z-[2]">
        Securing Session
      </p>

      {/* Spinner */}
      <Loader2 className="w-5 h-5 text-[#C7FF00] animate-spin mt-2 relative z-[2]" />
    </motion.div>
  );
}

