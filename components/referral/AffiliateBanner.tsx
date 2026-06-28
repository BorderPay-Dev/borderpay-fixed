/**
 * Affiliate Program Banner — shown on dashboard footer for all users.
 * Dismissible via localStorage.
 */

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { affiliateProgramUrl } from '../../utils/affiliate/config';
import { backendAPI } from '../../utils/api/backendAPI';

const DISMISSED_KEY = 'affiliate_banner_dismissed_v2';

interface AffiliateBannerProps {
  kycStatus?: string;
}

export function AffiliateBanner({ kycStatus }: AffiliateBannerProps) {
  const [visible, setVisible] = useState(false);
  const [opening, setOpening] = useState(false);
  const tc = useThemeClasses();

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY) === 'true') return;
    setVisible(true);
  }, [kycStatus]);

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setVisible(false);
  };

  const handleJoin = async () => {
    if (opening) return;
    setOpening(true);
    try {
      let url = affiliateProgramUrl('banner');
      const sso = await backendAPI.affiliate.getSSOLink();
      if (sso.success && sso.data?.url) {
        url = sso.data.url;
      }
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      // Fallback path: open in current tab if popup/external open fails.
      if (!win) window.location.assign(url);
    } finally {
      setOpening(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="mx-4 mt-2 mb-1">
      <div
        className="flex items-center gap-2 rounded-xl border pl-3 pr-2 py-2"
        style={{
          backgroundColor: 'rgba(199, 255, 0, 0.06)',
          borderColor: 'rgba(199, 255, 0, 0.18)',
          borderLeftWidth: 3,
          borderLeftColor: '#C7FF00',
        }}
      >
        <p className={`${tc.text} text-[12px] font-medium min-w-0 flex-1 truncate`}>
          Affiliate Program Beta
        </p>

        <button
          onClick={handleJoin}
          disabled={opening}
          className="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors hover:opacity-90 whitespace-nowrap"
          style={{ backgroundColor: '#C7FF00', color: '#06080C' }}
        >
          {opening ? 'Opening…' : 'Join beta'}
        </button>

        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="shrink-0 p-1 rounded-md hover:bg-white/10 transition-colors"
        >
          <X size={13} className="text-gray-500" />
        </button>
      </div>
    </div>
  );
}
