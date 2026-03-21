/**
 * BorderPay Africa - Onboarding Flow
 * 3-step paging system with swipe navigation
 * Glassmorphic design with animated gradient background
 * i18n support for all 5 languages
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Send, CreditCard, Shield } from 'lucide-react';
import { useThemeLanguage } from '../../utils/i18n/ThemeLanguageContext';

interface OnboardingFlowProps {
  onComplete: () => void;
  onSkip?: () => void;
}

export function OnboardingFlow({ onComplete, onSkip }: OnboardingFlowProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [direction, setDirection] = useState(0);
  const { t } = useThemeLanguage();

  const slides = [
    {
      id: 1,
      title: t('onboarding.slide1Title'),
      description: t('onboarding.slide1Desc'),
      icon: Send,
      color: '#10B981',
    },
    {
      id: 2,
      title: t('onboarding.slide2Title'),
      description: t('onboarding.slide2Desc'),
      icon: CreditCard,
      color: '#3B82F6',
    },
    {
      id: 3,
      title: t('onboarding.slide3Title'),
      description: t('onboarding.slide3Desc'),
      icon: Shield,
      color: '#C7FF00',
    },
  ];

  const handleNext = () => {
    if (currentSlide === slides.length - 1) {
      onComplete();
    } else {
      setDirection(1);
      setCurrentSlide((prev) => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentSlide > 0) {
      setDirection(-1);
      setCurrentSlide((prev) => prev - 1);
    }
  };

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? '100%' : '-100%',
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction > 0 ? '-100%' : '100%',
      opacity: 0,
    }),
  };

  const slide = slides[currentSlide];
  const Icon = slide.icon;
  const isLastSlide = currentSlide === slides.length - 1;

  return (
    <div className="fixed inset-0 bg-[#0B0E11] flex flex-col overflow-hidden">
      {/* Animated gradient background */}
      <div className="glass-gradient-bg" />
      <div className="glass-noise-overlay" />

      {/* Skip Button */}
      <div className="absolute top-0 left-0 right-0 pt-safe z-10">
        <div className="flex justify-end px-6 py-4">
          <button
            onClick={onSkip}
            className="text-sm text-gray-400 uppercase tracking-[0.2em] font-semibold hover:text-white transition-colors"
          >
            {t('onboarding.skip')}
          </button>
        </div>
      </div>

      {/* Slides Container */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-hidden relative z-[2]">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentSlide}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { duration: 0.3, ease: 'easeOut' },
              opacity: { duration: 0.2 },
            }}
            className="w-full max-w-md flex flex-col items-center text-center"
          >
            {/* Icon with glass card */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="mb-8"
            >
              <div
                className="w-28 h-28 rounded-full mx-auto flex items-center justify-center bg-white/[0.04] backdrop-blur-xl border border-white/[0.06]"
                style={{
                  boxShadow: `0 0 60px ${slide.color}15, 0 0 120px ${slide.color}08`,
                }}
              >
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${slide.color}15` }}
                >
                  <slide.icon className="w-12 h-12" style={{ color: slide.color }} strokeWidth={2} />
                </div>
              </div>
            </motion.div>

            {/* Title */}
            <motion.h2
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="bp-text-h2 text-white mb-4 text-center whitespace-pre-line"
            >
              {slide.title}
            </motion.h2>

            {/* Description */}
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.4 }}
              className="bp-text-body text-gray-400 text-center max-w-sm mx-auto"
            >
              {slide.description}
            </motion.p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Controls */}
      <div className="pb-safe px-6 py-8 relative z-[2]">
        {/* Progress Dots */}
        <div className="flex justify-center gap-2 mb-8">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => {
                setDirection(index > currentSlide ? 1 : -1);
                setCurrentSlide(index);
              }}
              className="transition-all"
            >
              <div
                className={`h-2 rounded-full transition-all ${
                  index === currentSlide
                    ? 'w-8 bg-[#C7FF00]'
                    : 'w-2 bg-white/20'
                }`}
              />
            </button>
          ))}
        </div>

        {/* Continue Button */}
        <button
          onClick={handleNext}
          className="w-full bg-[#C7FF00] text-black py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-2 transition-all active:scale-[0.98] hover:bg-[#D4FF33] hover:shadow-[0_0_20px_rgba(199,255,0,0.3)]"
          style={{ letterSpacing: '0.025em' }}
        >
          {isLastSlide ? t('onboarding.getStarted') : t('onboarding.continue')}
          <ArrowRight size={20} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
