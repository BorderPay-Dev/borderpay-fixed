/**
 * BorderPay Africa - Account Status Badge
 * Shows account tier: Starter → Verified → Active
 * In sandbox mode: shows "Beta" badge with neon green styling
 */

import React from 'react';
import { Shield, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { ENV_CONFIG } from '../../utils/config/environment';

export type AccountStatus = 'starter' | 'verified' | 'active';

interface AccountStatusBadgeProps {
  status: AccountStatus;
  size?: 'sm' | 'md' | 'lg';
}

const statusConfig = {
  starter: {
    label: 'Starter',
    icon: Shield,
    bgColor: 'bg-gray-500/10',
    textColor: 'text-gray-400',
    iconColor: 'text-gray-500',
    borderColor: 'border-gray-500/20',
  },
  verified: {
    label: 'Verified',
    icon: ShieldCheck,
    bgColor: 'bg-blue-500/10',
    textColor: 'text-blue-400',
    iconColor: 'text-blue-500',
    borderColor: 'border-blue-500/20',
  },
  active: {
    label: 'Active',
    icon: Sparkles,
    bgColor: 'bg-[#C7FF00]/10',
    textColor: 'text-[#C7FF00]',
    iconColor: 'text-[#C7FF00]',
    borderColor: 'border-[#C7FF00]/20',
  },
};

// Sandbox badge config
const sandboxConfig = {
  label: 'Beta Access',
  icon: Zap,
  bgColor: 'bg-[#C7FF00]/15',
  textColor: 'text-[#C7FF00]',
  iconColor: 'text-[#C7FF00]',
  borderColor: 'border-[#C7FF00]/30',
};

const sizeConfig = {
  sm: {
    padding: 'px-2 py-1',
    iconSize: 12,
    textSize: 'text-xs',
  },
  md: {
    padding: 'px-3 py-1.5',
    iconSize: 14,
    textSize: 'text-xs',
  },
  lg: {
    padding: 'px-4 py-2',
    iconSize: 16,
    textSize: 'text-sm',
  },
};

export function AccountStatusBadge({ status, size = 'md' }: AccountStatusBadgeProps) {
  // In sandbox mode, always show "Beta Access" badge regardless of actual status
  const config = statusConfig[status];
  const sizeStyles = sizeConfig[size];
  const Icon = config.icon;

  return (
    <div
      className={`
        inline-flex items-center gap-1.5 rounded-full border
        ${config.bgColor} ${config.borderColor} ${sizeStyles.padding}
      `}
    >
      <Icon
        className={config.iconColor}
        size={sizeStyles.iconSize}
        strokeWidth={2.5}
      />
      <span className={`${config.textColor} ${sizeStyles.textSize} font-semibold uppercase tracking-wide`}>
        {config.label}
      </span>
    </div>
  );
}