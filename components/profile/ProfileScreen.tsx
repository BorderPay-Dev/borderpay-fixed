/**
 * BorderPay Africa - Profile Screen
 * Loads user data from the backend /user/profile endpoint (KV + Auth merged).
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  MapPin,
  Globe,
  ShieldCheck,
  Edit2,
  Save,
  X,
  Loader2,
  Camera,
  Calendar,
  Clock,
} from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { authAPI } from '../../utils/supabase/client';
import { toast } from 'sonner';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { friendlyError } from '../../utils/errors/friendlyError';
import { deriveKycStatus } from '../../utils/config/environment';
import { deriveWalletStatus, type WalletStatus } from '../../utils/financial/walletStatus';
import { SecurityStatus, TOTPManager } from '../../utils/security/SecurityManager';
import { Skeleton, SkeletonRows } from '../common/Skeleton';
import { navPerfTrackCache } from '../../utils/performance/navigationPerf';

interface ProfileScreenProps {
  userId: string;
  onBack: () => void;
}
const PROFILE_FETCH_TIMEOUT_MS = 1400;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function readLocalEmailConfirmed(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const user = parsed?.currentSession?.user ?? parsed?.user;
      if (user?.email_confirmed_at || user?.confirmed_at) return true;
    }
  } catch { /* ignore */ }
  return false;
}

function deriveEmailConfirmed(u: any): boolean {
  return !!(u?.email_confirmed || u?.email_confirmed_at || u?.confirmed_at || readLocalEmailConfirmed());
}

export function ProfileScreen({ userId, onBack }: ProfileScreenProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPic, setUploadingPic] = useState(false);
  const [walletStatus, setWalletStatus] = useState<WalletStatus>('locked');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  // Read cached user data synchronously to avoid blank/flash on mount
  const [profile, setProfile] = useState(() => {
    const cachedAuthUser = authAPI.getStoredUser() || {};
    const defaults = {
      full_name: cachedAuthUser?.full_name || '',
      company_name: cachedAuthUser?.company_name || '',
      email: cachedAuthUser?.email || '',
      phone: cachedAuthUser?.phone || '',
      address: '',
      address_object: null as Record<string, any> | null,
      city: '',
      country: '',
      postal_code: '',
      date_of_birth: '',
      kyc_status: 'pending',
      bridge_kyc_status: null as string | null,
      bridge_kyb_status: null as string | null,
      bridge_account_status: null as string | null,
      wallet_status: 'locked' as WalletStatus,
      verification_status: 'not_started',
      account_type: cachedAuthUser?.account_type || 'individual',
      is_unlocked: false,
      email_confirmed: false,
      last_sign_in_at: null as string | null,
      created_at: '',
      profile_picture_url: (cachedAuthUser?.profile_picture_url || cachedAuthUser?.avatar_url || null) as string | null,
      two_factor_enabled: false,
    };
    try {
      const businessNameKey = `borderpay_business_name_v1:${userId}`;
      const cachedBusinessName = String(localStorage.getItem(businessNameKey) || '').trim();
      const cached = localStorage.getItem('borderpay_user');
      if (cached) {
        const u = JSON.parse(cached);
        const merged = {
          full_name: u.full_name || '',
          company_name: u.company_name || cachedBusinessName || '',
          email: u.email || '',
          phone: u.phone || '',
          address: u.address || '',
          address_object: u.address_object || null,
          city: u.city || '',
          country: u.country || '',
          postal_code: u.postal_code || '',
          date_of_birth: u.date_of_birth || '',
          kyc_status: u.kyc_status || 'pending',
          bridge_kyc_status: u.bridge_kyc_status ?? null,
          bridge_kyb_status: u.bridge_kyb_status ?? null,
          bridge_account_status: u.bridge_account_status ?? null,
          wallet_status: (u.wallet_status as WalletStatus) || deriveWalletStatus({
            account_type: u.account_type,
            bridge_kyc_status: u.bridge_kyc_status,
            bridge_kyb_status: u.bridge_kyb_status,
            bridge_account_status: u.bridge_account_status,
            is_unlocked: Boolean(u.is_unlocked || u.wallet_activated),
            has_funding_surface: Boolean(u.has_funding_surface),
          }),
          verification_status: u.verification_status || 'not_started',
          account_type: u.account_type || 'individual',
          is_unlocked: u.is_unlocked || false,
          email_confirmed: deriveEmailConfirmed(u),
          last_sign_in_at: u.last_sign_in_at || null,
          created_at: u.created_at || '',
          profile_picture_url: u.profile_picture_url || null,
          two_factor_enabled: Boolean(u.two_factor_enabled || (() => {
            try { return !!SecurityStatus.get(userId).has2FA || TOTPManager.isEnabled(userId); } catch { return false; }
          })()),
        };
        return merged;
      }
    } catch {}
    return defaults;
  });
  const [loading, setLoading] = useState(() => !localStorage.getItem('borderpay_user'));

  const [editedProfile, setEditedProfile] = useState({ ...profile });
  const profileRefreshTsKey = `borderpay_profile_refreshed_at:${userId}`;

  useEffect(() => {
    const hasCachedProfile = Boolean(profile?.email || profile?.full_name || profile?.company_name);
    navPerfTrackCache('profile', hasCachedProfile);
  }, [profile?.email, profile?.full_name, profile?.company_name]);

  const mergeProfileCache = (next: Record<string, unknown>) => {
    try {
      const cached = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
      localStorage.setItem('borderpay_user', JSON.stringify({ ...cached, ...next }));
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadProfile();
  }, [userId]);

  const loadProfile = async () => {
    // Route parity: keep profile first paint from cache and avoid repeating the
    // same profile request on every quick nav open/close.
    try {
      const last = Number(localStorage.getItem(profileRefreshTsKey) || '0');
      // Never skip refresh when the local cache still says email is unconfirmed.
      // This prevents a fresh verification click from being masked by the
      // 60-second route cache window.
      if (Number.isFinite(last) && Date.now() - last < 60_000 && profile.email_confirmed) {
        return;
      }
    } catch { /* noop */ }

    // Fetch fresh data from backend (cached data already loaded synchronously in useState)
    try {
      const cachedCompanyName = (() => {
        try {
          const byUserId = String(localStorage.getItem(`borderpay_business_name_v1:${userId}`) || '').trim();
          if (byUserId) return byUserId;
          const cached = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
          return cached?.company_name || '';
        } catch {
          return '';
        }
      })();
      const result = await withTimeout(
        backendAPI.user.getProfile(),
        PROFILE_FETCH_TIMEOUT_MS,
        { success: false, error: 'profile_timeout' } as any,
      );

      if (result.success && result.data?.user) {
        const u = result.data.user as any;
        const profileData = {
          full_name: u.full_name || '',
          company_name: u.company_name || cachedCompanyName || '',
          email: u.email || '',
          phone: u.phone || '',
          address: u.address || '',
          address_object: u.address_object || null,
          city: u.city || '',
          country: u.country || '',
          postal_code: u.postal_code || '',
          date_of_birth: u.date_of_birth || '',
          kyc_status: u.kyc_status || 'pending',
          bridge_kyc_status: u.bridge_kyc_status ?? null,
          bridge_kyb_status: u.bridge_kyb_status ?? null,
          bridge_account_status: u.bridge_account_status ?? null,
          wallet_status: (u.wallet_status as WalletStatus) || deriveWalletStatus({
            account_type: u.account_type,
            bridge_kyc_status: u.bridge_kyc_status,
            bridge_kyb_status: u.bridge_kyb_status,
            bridge_account_status: u.bridge_account_status,
            is_unlocked: Boolean(u.is_unlocked || u.wallet_activated),
            has_funding_surface: Boolean(u.has_funding_surface),
          }),
          verification_status: u.verification_status || 'not_started',
          account_type: u.account_type || 'individual',
          is_unlocked: u.is_unlocked || false,
          email_confirmed: deriveEmailConfirmed(u),
          last_sign_in_at: u.last_sign_in_at || null,
          created_at: u.created_at || '',
          profile_picture_url: u.profile_picture_url || null,
          two_factor_enabled: Boolean(u.two_factor_enabled || (() => {
            try { return !!SecurityStatus.get(userId).has2FA || TOTPManager.isEnabled(userId); } catch { return false; }
          })()),
        };
        setProfile(profileData);
        setEditedProfile(profileData);
        setWalletStatus(profileData.wallet_status);
        mergeProfileCache({ ...u, company_name: profileData.company_name });
        try { localStorage.setItem(profileRefreshTsKey, String(Date.now())); } catch { /* noop */ }
        if (profileData.account_type === 'business' && profileData.company_name) {
          try { localStorage.setItem(`borderpay_business_name_v1:${userId}`, profileData.company_name); } catch { /* ignore */ }
        }

        // Do not block first paint on business-profile enrichment.
        setLoading(false);

        // Business profile enrichment is deliberately background-only: the
        // profile route already painted from cached/user-profile data above.
        // The business profile table remains the canonical company-name source.
        if (profileData.account_type === 'business') {
          void (async () => {
            try {
              const biz = await backendAPI.business.getProfile();
              const company_name = String((biz as any)?.data?.company_name || '').trim();
              if ((biz as any)?.success && company_name) {
                setProfile((p) => ({ ...p, company_name }));
                setEditedProfile((p) => ({ ...p, company_name }));
                mergeProfileCache({ company_name, account_type: 'business' });
                try { localStorage.setItem(`borderpay_business_name_v1:${userId}`, company_name); } catch { /* ignore */ }
              }
            } catch { /* background enrichment only */ }
          })();
        }
      }
      // No error toast — screen already shows cached or default data
    } catch (_) {
      // Silent — the screen works with cached data or defaults
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await backendAPI.user.updateProfile({
        full_name: editedProfile.full_name,
        phone: editedProfile.phone,
        address: editedProfile.address,
        city: editedProfile.city,
        country: editedProfile.country,
        postal_code: editedProfile.postal_code,
        date_of_birth: editedProfile.date_of_birth,
      });

      if (result.success) {
        // Update local state with backend response or fallback to edited values
        const updated = result.data?.user || editedProfile;
        setProfile({ ...profile, ...updated });
        setEditing(false);
        toast.success('Profile updated successfully');
        // Also update localStorage so dashboard shows fresh data
        const storedUser = localStorage.getItem('borderpay_user');
        if (storedUser) {
          try {
            const parsed = JSON.parse(storedUser);
            localStorage.setItem('borderpay_user', JSON.stringify({ ...parsed, ...updated }));
          } catch (_) { /* ignore */ }
        }
      } else {
        toast.error(friendlyError(result.error, 'Failed to update profile'));
      }
    } catch (error) {
      toast.error('Unable to save your profile changes. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedProfile({ ...profile });
    setEditing(false);
  };

  const handleProfilePictureClick = () => {
    if (!uploadingPic) fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPic(true);
    try {
      const result = await backendAPI.user.uploadProfilePicture(file);
      const picUrl = result.data?.data?.profile_picture_url || result.data?.profile_picture_url;
      if (result.success && picUrl) {
        setProfile((p) => ({ ...p, profile_picture_url: picUrl }));
        setEditedProfile((p) => ({ ...p, profile_picture_url: picUrl }));
        try {
          const cached = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
          localStorage.setItem('borderpay_user', JSON.stringify({ ...cached, profile_picture_url: picUrl }));
          window.dispatchEvent(new CustomEvent('borderpay:profile_picture_updated', {
            detail: { profile_picture_url: picUrl },
          }));
        } catch { /* keep local screen state even if cache update fails */ }
        toast.success('Profile picture updated');
      } else {
        toast.error(friendlyError(result.error, 'Failed to upload picture'));
      }
    } catch (error) {
      toast.error('Failed to upload picture');
    } finally {
      setUploadingPic(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const getKycBadge = () => {
    // Bridge-first: a Bridge rejection shows "did not pass" even if legacy
    // kyc_status is still 'pending'; legacy-verified users are preserved.
    switch (deriveKycStatus(profile)) {
      case 'verified':
        return { label: t('profile.verified'), color: 'text-[#C7FF00]', bg: 'bg-[#C7FF00]/10 border-[#C7FF00]/20' };
      case 'rejected':
        return { label: t('profile.rejected') || 'Verification failed', color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/20' };
      case 'under_review':
        return { label: t('profile.underReview'), color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/20' };
      case 'pending':
        return { label: t('profile.unverified'), color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/20' };
      default:
        return { label: t('profile.notStarted'), color: 'text-gray-400', bg: 'bg-gray-400/10 border-gray-400/20' };
    }
  };

  const kycBadge = getKycBadge();
  const isBusinessAccount = profile.account_type === 'business';
  const profileTitle = isBusinessAccount ? 'Business profile' : t('profile.title');
  const informationTitle = isBusinessAccount ? 'Business information' : 'Personal Information';
  const nameLabel = isBusinessAccount ? 'Primary contact' : 'Full Name';
  const displayName = isBusinessAccount
    ? (profile.company_name || 'Business account')
    : (profile.full_name || 'No Name');
  const avatarInitial = displayName?.charAt(0)?.toUpperCase() || 'U';
  const addressObject = profile.address_object || {};
  const bridgeStreet = [addressObject.street_line_1, addressObject.street_line_2].filter(Boolean).join(', ');
  const displayAddress = editing ? editedProfile.address : (profile.address || bridgeStreet);
  const displayCity = editing ? editedProfile.city : (profile.city || addressObject.city || '');
  const displayPostalCode = editing ? editedProfile.postal_code : (profile.postal_code || addressObject.postal_code || '');
  const displayCountry = editing ? editedProfile.country : (profile.country || addressObject.country || '');
  const canonicalVerification = deriveKycStatus(profile);
  const verificationLabel = canonicalVerification === 'verified'
    ? 'Verified'
    : canonicalVerification === 'rejected'
      ? 'Rejected'
      : canonicalVerification === 'under_review'
        ? 'Under review'
        : canonicalVerification === 'pending'
          ? 'Pending'
          : 'Not started';
  const walletAccessActivated = walletStatus === 'active' || canonicalVerification === 'verified';

  if (loading) {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text} pb-safe`}>
        <div className="max-w-2xl mx-auto px-5 pt-5">
          <Skeleton className="h-3 w-28 mb-6" />
          <div className="flex flex-col items-center mb-6">
            <Skeleton className="w-24 h-24 rounded-full mb-4" />
            <Skeleton className="h-5 w-40 mb-2" />
            <Skeleton className="h-4 w-52" />
          </div>
          <SkeletonRows count={8} />
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${tc.bg} ${tc.text} pb-safe`}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Inline section eyebrow + edit toggle. AppShell owns the top chrome
          for top-level routes; we no longer render a duplicate sticky bar. */}
      <div className="max-w-2xl mx-auto px-5 pt-5 flex items-center justify-between">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>
          {profileTitle}
        </p>
        <button
          onClick={() => (editing ? handleCancel() : setEditing(true))}
          disabled={saving}
          className={`p-2 -mr-2 rounded-full ${tc.hoverBg} transition-colors`}
          aria-label={editing ? 'Cancel edit' : 'Edit profile'}
        >
          {editing ? <X size={16} className={tc.text} /> : <Edit2 size={16} className={tc.text} />}
        </button>
      </div>

      {/* Content */}
      <div className="px-6 py-6 space-y-6">
        {/* Avatar + Name */}
        <div className="flex flex-col items-center">
          <div className="relative mb-4">
            <button
              onClick={handleProfilePictureClick}
              className="relative w-24 h-24 rounded-full overflow-hidden"
              disabled={uploadingPic}
            >
              {profile.profile_picture_url ? (
                <img
                  src={profile.profile_picture_url}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#C7FF00] to-[#95E03D] flex items-center justify-center">
                  <span className="text-4xl font-black text-black">
                    {avatarInitial}
                  </span>
                </div>
              )}
              {/* Camera overlay */}
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity rounded-full">
                {uploadingPic ? (
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                ) : (
                  <Camera className="w-6 h-6 text-white" />
                )}
              </div>
            </button>
          </div>

          <h2 className="text-xl font-bold text-white">{displayName}</h2>
          <p className="text-gray-400 text-sm mt-0.5">{profile.email}</p>

          <div className={`flex items-center gap-2 mt-2 px-3 py-1.5 border rounded-full ${kycBadge.bg}`}>
            <ShieldCheck className={`w-4 h-4 ${kycBadge.color}`} />
            <span className={`text-xs font-semibold ${kycBadge.color}`}>{kycBadge.label}</span>
          </div>
        </div>

        {/* Profile info */}
        <div className="space-y-3">
          <h3 className="text-xs text-gray-400 font-semibold uppercase tracking-wider px-1">{informationTitle}</h3>

          {isBusinessAccount && (
            <ProfileField
              icon={User}
              label="Business name"
              value={profile.company_name}
              editing={false}
              disabled
            />
          )}

          <ProfileField
            icon={User}
            label={nameLabel}
            value={editing ? editedProfile.full_name : profile.full_name}
            editing={editing}
            onChange={(value) => setEditedProfile({ ...editedProfile, full_name: value })}
          />

          <ProfileField
            icon={Mail}
            label="Email"
            value={profile.email}
            editing={false}
            disabled
            badge={profile.email_confirmed ? 'Confirmed' : 'Unconfirmed'}
            badgeColor={profile.email_confirmed ? 'text-[#C7FF00]' : 'text-orange-400'}
          />

          <ProfileField
            icon={Phone}
            label="Phone"
            value={editing ? editedProfile.phone : profile.phone}
            editing={editing}
            onChange={(value) => setEditedProfile({ ...editedProfile, phone: value })}
            type="tel"
          />

          <ProfileField
            icon={Calendar}
            label="Date of Birth"
            value={editing ? editedProfile.date_of_birth : profile.date_of_birth}
            editing={editing}
            onChange={(value) => setEditedProfile({ ...editedProfile, date_of_birth: value })}
            type="date"
          />
        </div>

        {/* Address */}
        <div className="space-y-3">
          <h3 className="text-xs text-gray-400 font-semibold uppercase tracking-wider px-1">Address</h3>

          <ProfileField
            icon={MapPin}
            label="Street Address"
            value={displayAddress}
            editing={editing}
            onChange={(value) => setEditedProfile({ ...editedProfile, address: value })}
          />

          <div className="grid grid-cols-2 gap-3">
            <ProfileField
              icon={MapPin}
              label="City"
              value={displayCity}
              editing={editing}
              onChange={(value) => setEditedProfile({ ...editedProfile, city: value })}
            />
            <ProfileField
              icon={MapPin}
              label="Postal Code"
              value={displayPostalCode}
              editing={editing}
              onChange={(value) => setEditedProfile({ ...editedProfile, postal_code: value })}
            />
          </div>

          <ProfileField
            icon={Globe}
            label="Country"
            value={displayCountry}
            editing={false}
            disabled
          />
        </div>

        {/* Account Status */}
        <div className="space-y-3">
          <h3 className="text-xs text-gray-400 font-semibold uppercase tracking-wider px-1">Account Status</h3>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
            <StatusRow label="Account Type" value={profile.account_type === 'business' ? 'Business' : 'Individual'} />
            <StatusRow label="Verification Status" value={verificationLabel} />
            <StatusRow
              label="Wallet Access"
              value={walletAccessActivated ? 'Activated' : 'Locked'}
              valueColor={walletAccessActivated ? 'text-[#C7FF00]' : 'text-orange-400'}
            />
            <StatusRow label="2FA" value={profile.two_factor_enabled ? 'Enabled' : 'Disabled'} valueColor={profile.two_factor_enabled ? 'text-[#C7FF00]' : 'text-orange-400'} />
            {profile.last_sign_in_at && (
              <StatusRow
                label="Last Sign-in"
                value={new Date(profile.last_sign_in_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
              />
            )}
            {profile.created_at && (
              <StatusRow
                label="Member Since"
                value={new Date(profile.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
              />
            )}
          </div>
        </div>

        {/* Save Button */}
        {editing && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={handleSave}
            disabled={saving}
            className="w-full py-4 bg-[#C7FF00] text-black font-semibold rounded-xl hover:bg-[#B8F000] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Changes
              </>
            )}
          </motion.button>
        )}
      </div>
    </div>
  );
}

function ProfileField({
  icon: Icon,
  label,
  value,
  editing,
  onChange,
  disabled,
  type = 'text',
  badge,
  badgeColor,
}: {
  icon: any;
  label: string;
  value: string;
  editing: boolean;
  onChange?: (value: string) => void;
  disabled?: boolean;
  type?: string;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-gray-400" />
          <label className="text-xs text-gray-400 font-semibold uppercase tracking-wider">{label}</label>
        </div>
        {badge && (
          <span className={`text-xs font-semibold ${badgeColor || 'text-gray-400'}`}>{badge}</span>
        )}
      </div>
      {editing && !disabled ? (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          className="w-full bg-transparent text-white bp-text-body outline-none placeholder-gray-600"
          placeholder={`Enter ${label.toLowerCase()}`}
        />
      ) : (
        <p className={`bp-text-body ${value ? 'text-white' : 'text-gray-600'}`}>
          {value || 'Not provided'}
        </p>
      )}
    </div>
  );
}

function StatusRow({
  label,
  value,
  valueColor = 'text-white',
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400 text-sm">{label}</span>
      <span className={`text-sm font-medium ${valueColor}`}>{value}</span>
    </div>
  );
}
