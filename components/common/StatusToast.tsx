/**
 * BorderPay Africa - Professional Status Toast System
 * Custom-themed toast notifications with banking-grade UX
 * Supports: success, error, warning, info, loading
 * Uses tc.* theme classes for consistent styling
 */

import React from 'react';
import { toast as sonnerToast } from 'sonner';
import {
  CheckCircle, XCircle, AlertTriangle, Info, Loader2,
  ShieldAlert, Wifi, WifiOff, CreditCard, Wallet,
  ArrowDownLeft, ArrowUpRight, Snowflake, Trash2,
  ShieldCheck, Lock, UserX, ServerCrash, RefreshCw,
} from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

interface ToastOptions {
  title: string;
  message?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  icon?: React.ReactNode;
}

const typeConfig: Record<ToastType, {
  icon: React.ReactNode;
  accentColor: string;
  bgColor: string;
  borderColor: string;
  iconBg: string;
  titleColor: string;
  messageColor: string;
}> = {
  success: {
    icon: <CheckCircle size={20} />,
    accentColor: '#C7FF00',
    bgColor: 'rgba(199,255,0,0.06)',
    borderColor: 'rgba(199,255,0,0.15)',
    iconBg: 'rgba(199,255,0,0.12)',
    titleColor: '#C7FF00',
    messageColor: 'rgba(199,255,0,0.7)',
  },
  error: {
    icon: <XCircle size={20} />,
    accentColor: '#FF4D6A',
    bgColor: 'rgba(255,77,106,0.06)',
    borderColor: 'rgba(255,77,106,0.15)',
    iconBg: 'rgba(255,77,106,0.12)',
    titleColor: '#FF4D6A',
    messageColor: 'rgba(255,77,106,0.7)',
  },
  warning: {
    icon: <AlertTriangle size={20} />,
    accentColor: '#FFB347',
    bgColor: 'rgba(255,179,71,0.06)',
    borderColor: 'rgba(255,179,71,0.15)',
    iconBg: 'rgba(255,179,71,0.12)',
    titleColor: '#FFB347',
    messageColor: 'rgba(255,179,71,0.7)',
  },
  info: {
    icon: <Info size={20} />,
    accentColor: '#60A5FA',
    bgColor: 'rgba(96,165,250,0.06)',
    borderColor: 'rgba(96,165,250,0.15)',
    iconBg: 'rgba(96,165,250,0.12)',
    titleColor: '#60A5FA',
    messageColor: 'rgba(96,165,250,0.7)',
  },
  loading: {
    icon: <Loader2 size={20} className="animate-spin" />,
    accentColor: '#C7FF00',
    bgColor: 'rgba(199,255,0,0.04)',
    borderColor: 'rgba(199,255,0,0.10)',
    iconBg: 'rgba(199,255,0,0.08)',
    titleColor: '#C7FF00',
    messageColor: 'rgba(199,255,0,0.6)',
  },
};

/** Custom toast renderer */
function ToastContent({
  type,
  title,
  message,
  action,
  customIcon,
}: {
  type: ToastType;
  title: string;
  message?: string;
  action?: { label: string; onClick: () => void };
  customIcon?: React.ReactNode;
}) {
  const config = typeConfig[type];
  return (
    <div
      className="flex items-start gap-3 w-full min-w-0 py-0.5"
      style={{ color: config.accentColor }}
    >
      {/* Icon */}
      <div
        className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center mt-0.5"
        style={{ background: config.iconBg }}
      >
        {customIcon || config.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className="text-[13px] font-semibold leading-tight truncate"
          style={{ color: config.titleColor }}
        >
          {title}
        </p>
        {message && (
          <p
            className="text-[11.5px] leading-snug mt-0.5 line-clamp-2"
            style={{ color: config.messageColor }}
          >
            {message}
          </p>
        )}
        {action && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              action.onClick();
            }}
            className="text-[11px] font-bold mt-1.5 underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity"
            style={{ color: config.accentColor }}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

/** ─── Main showToast API ────────────────────────────────────────────── */
function createToast(type: ToastType, opts: ToastOptions) {
  const config = typeConfig[type];
  return sonnerToast.custom(
    (id) => (
      <ToastContent
        type={type}
        title={opts.title}
        message={opts.message}
        action={opts.action}
        customIcon={opts.icon}
      />
    ),
    {
      duration: opts.duration ?? (type === 'error' ? 5000 : type === 'loading' ? Infinity : 3500),
      style: {
        background: '#0F1215',
        border: `1px solid ${config.borderColor}`,
        borderRadius: '16px',
        padding: '12px 14px',
        boxShadow: `0 8px 32px -4px rgba(0,0,0,0.6), 0 0 0 1px ${config.borderColor}`,
        backdropFilter: 'blur(24px)',
        maxWidth: '380px',
        width: '100%',
      },
    }
  );
}

export const showToast = {
  success: (titleOrOpts: string | ToastOptions, message?: string) => {
    const opts = typeof titleOrOpts === 'string'
      ? { title: titleOrOpts, message }
      : titleOrOpts;
    return createToast('success', opts);
  },
  error: (titleOrOpts: string | ToastOptions, message?: string) => {
    const opts = typeof titleOrOpts === 'string'
      ? { title: titleOrOpts, message }
      : titleOrOpts;
    return createToast('error', opts);
  },
  warning: (titleOrOpts: string | ToastOptions, message?: string) => {
    const opts = typeof titleOrOpts === 'string'
      ? { title: titleOrOpts, message }
      : titleOrOpts;
    return createToast('warning', opts);
  },
  info: (titleOrOpts: string | ToastOptions, message?: string) => {
    const opts = typeof titleOrOpts === 'string'
      ? { title: titleOrOpts, message }
      : titleOrOpts;
    return createToast('info', opts);
  },
  loading: (titleOrOpts: string | ToastOptions, message?: string) => {
    const opts = typeof titleOrOpts === 'string'
      ? { title: titleOrOpts, message }
      : titleOrOpts;
    return createToast('loading', opts);
  },
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),

  // ─── Contextual Banking Presets ──────────────────────────────────
  networkError: () =>
    createToast('error', {
      title: 'Connection Lost',
      message: 'Please check your internet connection and try again.',
      icon: <WifiOff size={20} />,
      action: { label: 'Retry', onClick: () => window.location.reload() },
    }),

  unauthorized: () =>
    createToast('error', {
      title: 'Session Expired',
      message: 'Please log in again to continue.',
      icon: <Lock size={20} />,
      duration: 6000,
    }),

  serverError: (detail?: string) =>
    createToast('error', {
      title: 'Service Temporarily Unavailable',
      message: detail || 'We\'re experiencing a temporary issue. Your data is safe. Please try again shortly.',
      icon: <ServerCrash size={20} />,
      duration: 6000,
    }),

  insufficientBalance: (required?: string, available?: string) =>
    createToast('warning', {
      title: 'Insufficient Balance',
      message: required && available
        ? `Required: ${required}. Available: ${available}.`
        : 'You don\'t have enough funds for this transaction.',
      icon: <Wallet size={20} />,
    }),

  cardFunded: (amount: string, last4: string) =>
    createToast('success', {
      title: 'Card Funded',
      message: `$${amount} added to card ending in ${last4}.`,
      icon: <CreditCard size={20} />,
    }),

  cardFrozen: (last4: string) =>
    createToast('info', {
      title: 'Card Frozen',
      message: `Card ending in ${last4} has been temporarily frozen.`,
      icon: <Snowflake size={20} />,
    }),

  cardTerminated: (last4: string, refund?: string) =>
    createToast('warning', {
      title: 'Card Terminated',
      message: refund
        ? `Card ending in ${last4} terminated. $${refund} refunded to wallet.`
        : `Card ending in ${last4} has been permanently terminated.`,
      icon: <Trash2 size={20} />,
    }),

  transferSent: (amount: string, recipient: string) =>
    createToast('success', {
      title: 'Transfer Sent',
      message: `${amount} sent to ${recipient} successfully.`,
      icon: <ArrowUpRight size={20} />,
    }),

  transferReceived: (amount: string, sender: string) =>
    createToast('success', {
      title: 'Money Received',
      message: `${amount} received from ${sender}.`,
      icon: <ArrowDownLeft size={20} />,
    }),

  pinVerified: () =>
    createToast('success', {
      title: 'PIN Verified',
      message: 'Your transaction PIN has been confirmed.',
      icon: <ShieldCheck size={20} />,
      duration: 2000,
    }),

  kycRequired: () =>
    createToast('warning', {
      title: 'Verification Required',
      message: 'Complete identity verification to unlock this feature.',
      icon: <ShieldAlert size={20} />,
      duration: 6000,
    }),

  rateLimited: () =>
    createToast('warning', {
      title: 'Too Many Attempts',
      message: 'Please wait a moment before trying again.',
      icon: <RefreshCw size={20} />,
    }),
};