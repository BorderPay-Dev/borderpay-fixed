/**
 * Affiliate Program Banner — shown at top of dashboard for eligible users.
 * Dismissible permanently via localStorage.
 */

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../utils/supabase/client';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

const AFFILIATE_URL = 'https://affiliates.borderpayafrica.com';
const DISMISSED_KEY = 'affiliate_banner_dismissed';

interface AffiliateBannerProps {
  kycStatus: string;
  mapleradStatus: string;
  userEmail: string;
}

export function AffiliateBanner({ kycStatus, mapleradStatus, userEmail }: AffiliateBannerProps) {
  const [visible, setVisible] = useState(false);
  const tc = useThemeClasses();

  useEffect(() => {
    // Only show to fully active users
    if (kycStatus !== 'verified' || mapleradStatus !== 'enrolled') return;
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
  }, [kycStatus, mapleradStatus, userEmail]);

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
        className="flex items-center gap-2 rounded-xl border px-3 py-2.5"
        style={{
          backgroundColor: 'rgba(0, 229, 143, 0.06)',
          borderColor: 'rgba(0, 229, 143, 0.18)',
          borderLeftWidth: 3,
          borderLeftColor: '#00E58F',
        }}
      >
        <span className="text-sm shrink-0">
          <span className={`${tc.text} text-xs font-medium`}>
            Earn money referring friends — Join our Affiliate Program
          </span>
        </span>

        <button
          onClick={handleJoin}
          className="shrink-0 ml-auto px-3 py-1 rounded-lg text-[11px] font-bold transition-colors hover:opacity-90"
          style={{ backgroundColor: '#00E58F', color: '#06080C' }}
        >
          Join Now &rarr;
        </button>

        <button
          onClick={handleDismiss}
          className="shrink-0 p-1 rounded-md hover:bg-white/10 transition-colors"
        >
          <X size={14} className="text-gray-500" />
        </button>
      </div>
    </div>
  );
}
