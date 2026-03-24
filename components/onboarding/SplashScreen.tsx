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
            <BorderPayLogo size={80} color="#000000" />
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