/**
 * Affiliate Program Banner — shown at top of dashboard for eligible users.
 * Dismissible permanently via localStorage.
 */

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../utils/supabase/client';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

const AFFILIATE_URL = 'https://affiliate.borderpayafrica.com/login';
const DISMISSED_KEY = 'affiliate_banner_dismissed';

interface AffiliateBannerProps {
  kycStatus: string;
  userEmail: string;
}

export function AffiliateBanner({ kycStatus, userEmail }: AffiliateBannerProps) {
  const [visible, setVisible] = useState(false);
  const tc = useThemeClasses();

  useEffect(() => {
    // Only show to verified users.
    if (kycStatus !== 'verified') return;
    if (localStorage.getItem(DISMISSED_KEY) === 'true') return;
    if (!userEmail) return;

    // Check if already an affiliate
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('affiliates')
          .select('id')
          .eq('email', userEmail)
          .eq('status', 'approved')
          .maybeSingle();
        if (!cancelled && !data) setVisible(true);
      } catch {
        // If table doesn't exist or query fails, show banner anyway
        if (!cancelled) setVisible(true);
      }
    })();
    return () => { cancelled = true; };
  }, [kycStatus, userEmail]);

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setVisible(false);
  };

  const handleJoin = () => {
    window.open(AFFILIATE_URL, '_blank', 'noopener,noreferrer');
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
          Earn money referring friends
        </p>

        <button
          onClick={handleJoin}
          className="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors hover:opacity-90 whitespace-nowrap"
          style={{ backgroundColor: '#C7FF00', color: '#06080C' }}
        >
          Join now
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
