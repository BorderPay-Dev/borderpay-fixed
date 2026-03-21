/**
 * BorderPay Africa - Inline Alert Component
 * Used inside forms, modals, and sections for contextual alerts
 * Supports: error, warning, info, success variants
 * Uses tc.* theme classes for consistent styling
 */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle, XCircle, Info, CheckCircle, X, ChevronRight,
} from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

type AlertVariant = 'error' | 'warning' | 'info' | 'success';

interface InlineAlertProps {
  variant?: AlertVariant;
  title?: string;
  message: string;
  show?: boolean;
  dismissible?: boolean;
  onDismiss?: () => void;
  onAction?: () => void;
  actionLabel?: string;
  icon?: React.ReactNode;
  className?: string;
}

const variantStyles: Record<AlertVariant, {
  bg: string;
  border: string;
  iconColor: string;
  titleColor: string;
  textColor: string;
  icon: React.ReactNode;
}> = {
  error: {
    bg: 'rgba(255,77,106,0.06)',
    border: 'rgba(255,77,106,0.15)',
    iconColor: '#FF4D6A',
    titleColor: '#FF4D6A',
    textColor: 'rgba(255,77,106,0.8)',
    icon: <XCircle size={16} />,
  },
  warning: {
    bg: 'rgba(255,179,71,0.06)',
    border: 'rgba(255,179,71,0.15)',
    iconColor: '#FFB347',
    titleColor: '#FFB347',
    textColor: 'rgba(255,179,71,0.8)',
    icon: <AlertTriangle size={16} />,
  },
  info: {
    bg: 'rgba(96,165,250,0.06)',
    border: 'rgba(96,165,250,0.15)',
    iconColor: '#60A5FA',
    titleColor: '#60A5FA',
    textColor: 'rgba(96,165,250,0.8)',
    icon: <Info size={16} />,
  },
  success: {
    bg: 'rgba(199,255,0,0.06)',
    border: 'rgba(199,255,0,0.15)',
    iconColor: '#C7FF00',
    titleColor: '#C7FF00',
    textColor: 'rgba(199,255,0,0.8)',
    icon: <CheckCircle size={16} />,
  },
};

export function InlineAlert({
  variant = 'error',
  title,
  message,
  show = true,
  dismissible = false,
  onDismiss,
  onAction,
  actionLabel,
  icon,
  className = '',
}: InlineAlertProps) {
  const tc = useThemeClasses();
  const styles = variantStyles[variant];

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.2 }}
          className={`overflow-hidden ${className}`}
        >
          <div
            className="flex items-start gap-2.5 px-3.5 py-3 rounded-2xl"
            style={{
              background: styles.bg,
              border: `1px solid ${styles.border}`,
            }}
          >
            {/* Icon */}
            <span
              className="flex-shrink-0 mt-0.5"
              style={{ color: styles.iconColor }}
            >
              {icon || styles.icon}
            </span>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {title && (
                <p
                  className="text-xs font-bold leading-tight mb-0.5"
                  style={{ color: styles.titleColor }}
                >
                  {title}
                </p>
              )}
              <p
                className="text-[11.5px] leading-relaxed"
                style={{ color: styles.textColor }}
              >
                {message}
              </p>
              {onAction && actionLabel && (
                <button
                  onClick={onAction}
                  className="flex items-center gap-0.5 text-[11px] font-bold mt-1.5 hover:opacity-80 transition-opacity"
                  style={{ color: styles.iconColor }}
                >
                  {actionLabel}
                  <ChevronRight size={12} />
                </button>
              )}
            </div>

            {/* Dismiss */}
            {dismissible && onDismiss && (
              <button
                onClick={onDismiss}
                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                style={{ color: styles.iconColor }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Convenience: API error parser
 * Extracts user-friendly message from backend error responses
 */
export function parseAPIError(error: any): { title: string; message: string; variant: AlertVariant } {
  // Network / fetch errors
  if (error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError')) {
    return {
      title: 'Connection Error',
      message: 'Unable to reach our servers. Please check your internet connection.',
      variant: 'error',
    };
  }

  // HTTP status-based
  const status = error?.status || error?.statusCode;
  if (status === 401 || status === 403) {
    return {
      title: 'Authentication Error',
      message: 'Your session has expired. Please log in again.',
      variant: 'error',
    };
  }
  if (status === 404) {
    return {
      title: 'Not Found',
      message: error?.error || 'The requested resource was not found.',
      variant: 'warning',
    };
  }
  if (status === 429) {
    return {
      title: 'Rate Limited',
      message: 'Too many requests. Please wait a moment and try again.',
      variant: 'warning',
    };
  }
  if (status >= 500) {
    return {
      title: 'Server Error',
      message: 'Something went wrong on our end. Please try again later.',
      variant: 'error',
    };
  }

  // Banking provider specific
  const msg = (error?.error || error?.message || '').toLowerCase();
  if (msg.includes('insufficient')) {
    return {
      title: 'Insufficient Funds',
      message: error.error || error.message,
      variant: 'warning',
    };
  }
  if (msg.includes('frozen')) {
    return {
      title: 'Card Frozen',
      message: 'This card is currently frozen. Unfreeze it to continue.',
      variant: 'info',
    };
  }
  if (msg.includes('terminated')) {
    return {
      title: 'Card Terminated',
      message: 'This card has been permanently terminated.',
      variant: 'error',
    };
  }
  if (msg.includes('kyc') || msg.includes('verification') || msg.includes('verify')) {
    return {
      title: 'Verification Needed',
      message: error.error || error.message || 'Complete identity verification to proceed.',
      variant: 'warning',
    };
  }

  // Default
  return {
    title: 'Request Could Not Be Completed',
    message: error?.error || error?.message || 'An unexpected issue occurred. Please try again or contact support if this continues.',
    variant: 'error',
  };
}