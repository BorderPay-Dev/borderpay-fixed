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
    console.log('🎬 SplashScreen: Mounted, will complete in 2.5s');
    const timer = setTimeout(() => {
      console.log('🎬 SplashScreen: Starting exit animation...');
      setIsExiting(true);
      setTimeout(() => {
        console.log('🎬 SplashScreen: Calling onComplete callback');
        onComplete();
      }, 500); // Wait for fade-out animation
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
          {/* Official App Icon (b logo with ®) */}
          <div className="w-[100px] h-[100px] flex items-center justify-center">
            <img
              src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='28' y='18' width='12' height='62' rx='6' fill='black'/><path d='M44 32 Q76 32 76 50 Q76 68 44 68 L44 56 Q62 56 62 50 Q62 44 44 44 Z' fill='black'/></svg>"
              alt="BorderPay Africa"
              className="w-full h-full object-contain"
            />
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