/**
 * BorderPay Africa - Professional Error State Component
 * Reusable empty/error/offline state for screens and sections
 * Uses tc.* theme classes for consistent styling
 */

import React from 'react';
import { motion } from 'motion/react';
import {
  WifiOff, ServerCrash, ShieldAlert, CreditCard, FileX, Search,
  AlertTriangle, RefreshCw, Inbox, Wallet, Clock, Ban, Loader2,
} from 'lucide-react';
import { useThemeClasses, useThemeLanguage } from '../../utils/i18n/ThemeLanguageContext';

type ErrorVariant =
  | 'network'
  | 'server'
  | 'unauthorized'
  | 'not-found'
  | 'empty'
  | 'empty-cards'
  | 'empty-transactions'
  | 'empty-wallets'
  | 'empty-search'
  | 'maintenance'
  | 'generic'
  | 'kyc-required';

interface ErrorStateProps {
  variant?: ErrorVariant;
  title?: string;
  message?: string;
  icon?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  onSecondaryAction?: () => void;
  secondaryLabel?: string;
  isRetrying?: boolean;
  compact?: boolean;
  className?: string;
}

const variantDefaults: Record<ErrorVariant, {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  message: string;
}> = {
  network: {
    icon: <WifiOff size={28} />,
    iconBg: 'bg-red-500/10',
    iconColor: 'text-red-400',
    title: 'No Internet Connection',
    message: 'Please check your network connection and try again.',
  },
  server: {
    icon: <ServerCrash size={28} />,
    iconBg: 'bg-orange-500/10',
    iconColor: 'text-orange-400',
    title: 'Service Temporarily Unavailable',
    message: 'We\'re experiencing a temporary issue. Your data is safe. Please try again in a moment.',
  },
  unauthorized: {
    icon: <ShieldAlert size={28} />,
    iconBg: 'bg-red-500/10',
    iconColor: 'text-red-400',
    title: 'Session Expired',
    message: 'Your session has expired. Please log in again to continue.',
  },
  'not-found': {
    icon: <FileX size={28} />,
    iconBg: 'bg-purple-500/10',
    iconColor: 'text-purple-400',
    title: 'Not Found',
    message: 'The resource you\'re looking for doesn\'t exist or has been moved.',
  },
  empty: {
    icon: <Inbox size={28} />,
    iconBg: 'bg-white/5',
    iconColor: 'text-white/40',
    title: 'Nothing Here Yet',
    message: 'This section is empty. Content will appear here when available.',
  },
  'empty-cards': {
    icon: <CreditCard size={28} />,
    iconBg: 'bg-[#C7FF00]/10',
    iconColor: 'text-[#C7FF00]',
    title: 'No Virtual Cards',
    message: 'Create your first virtual card to start making payments worldwide.',
  },
  'empty-transactions': {
    icon: <Clock size={28} />,
    iconBg: 'bg-purple-500/10',
    iconColor: 'text-purple-400',
    title: 'No Transactions',
    message: 'Your transaction history will appear here once you start transacting.',
  },
  'empty-wallets': {
    icon: <Wallet size={28} />,
    iconBg: 'bg-[#C7FF00]/10',
    iconColor: 'text-[#C7FF00]',
    title: 'No Wallets',
    message: 'Create a wallet to start sending and receiving money globally.',
  },
  'empty-search': {
    icon: <Search size={28} />,
    iconBg: 'bg-blue-500/10',
    iconColor: 'text-blue-400',
    title: 'No Results Found',
    message: 'Try adjusting your search or filters to find what you\'re looking for.',
  },
  maintenance: {
    icon: <AlertTriangle size={28} />,
    iconBg: 'bg-amber-500/10',
    iconColor: 'text-amber-400',
    title: 'Under Maintenance',
    message: 'We\'re making improvements. This feature will be back shortly.',
  },
  generic: {
    icon: <Ban size={28} />,
    iconBg: 'bg-red-500/10',
    iconColor: 'text-red-400',
    title: 'Something Unexpected Happened',
    message: 'We couldn\'t complete your request. Please try again or contact support if the issue persists.',
  },
  'kyc-required': {
    icon: <ShieldAlert size={28} />,
    iconBg: 'bg-amber-500/10',
    iconColor: 'text-amber-400',
    title: 'Verification Required',
    message: 'Complete your identity verification to access this feature.',
  },
};

export function ErrorState({
  variant = 'generic',
  title,
  message,
  icon,
  onRetry,
  retryLabel = 'Try Again',
  onSecondaryAction,
  secondaryLabel,
  isRetrying = false,
  compact = false,
  className = '',
}: ErrorStateProps) {
  const tc = useThemeClasses();
  const defaults = variantDefaults[variant];

  const resolvedTitle = title || defaults.title;
  const resolvedMessage = message || defaults.message;
  const resolvedIcon = icon || defaults.icon;

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 ${className}`}
      >
        <div className="flex items-start gap-3">
          <div className={`flex-shrink-0 w-10 h-10 ${defaults.iconBg} rounded-xl flex items-center justify-center ${defaults.iconColor}`}>
            {resolvedIcon}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${tc.text}`}>{resolvedTitle}</p>
            <p className={`text-xs ${tc.textMuted} mt-0.5 leading-relaxed`}>{resolvedMessage}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                disabled={isRetrying}
                className="text-xs font-bold text-[#C7FF00] mt-2 flex items-center gap-1.5 disabled:opacity-50"
              >
                {isRetrying ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                {isRetrying ? 'Retrying...' : retryLabel}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className={`flex flex-col items-center justify-center text-center px-6 ${className}`}
    >
      {/* Animated icon container */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.4, ease: 'easeOut' }}
        className={`w-20 h-20 ${defaults.iconBg} rounded-3xl flex items-center justify-center mb-5 relative`}
      >
        {/* Subtle pulse ring */}
        <div
          className="absolute inset-0 rounded-3xl animate-pulse opacity-30"
          style={{
            boxShadow: `0 0 0 6px ${defaults.iconBg}`,
          }}
        />
        <span className={defaults.iconColor}>{resolvedIcon}</span>
      </motion.div>

      {/* Title */}
      <motion.h3
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className={`text-lg font-bold ${tc.text} mb-2`}
      >
        {resolvedTitle}
      </motion.h3>

      {/* Message */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className={`text-sm ${tc.textSecondary} max-w-[280px] leading-relaxed mb-6`}
      >
        {resolvedMessage}
      </motion.p>

      {/* Action buttons */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="flex flex-col gap-3 w-full max-w-[240px]"
      >
        {onRetry && (
          <button
            onClick={onRetry}
            disabled={isRetrying}
            className="w-full bg-[#C7FF00] text-black py-3.5 rounded-2xl font-bold text-sm hover:bg-[#B8F000] transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isRetrying ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            {isRetrying ? 'Retrying...' : retryLabel}
          </button>
        )}
        {onSecondaryAction && secondaryLabel && (
          <button
            onClick={onSecondaryAction}
            className={`w-full ${tc.card} border ${tc.cardBorder} py-3.5 rounded-2xl font-semibold text-sm ${tc.text} ${tc.hoverBg} transition-all active:scale-[0.97]`}
          >
            {secondaryLabel}
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}