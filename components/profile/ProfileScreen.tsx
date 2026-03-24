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
import { toast } from 'sonner';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { friendlyError } from '../../utils/errors/friendlyError';

interface ProfileScreenProps {
  userId: string;
  onBack: () => void;
}

export function ProfileScreen({ userId, onBack }: ProfileScreenProps) {
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPic, setUploadingPic] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  const [profile, setProfile] = useState({
    full_name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    country: '',
    postal_code: '',
    date_of_birth: '',
    kyc_status: 'pending',
    account_type: 'individual',
    is_unlocked: false,
    email_confirmed: false,
    last_sign_in_at: null as string | null,
    created_at: '',
    profile_picture_url: null as string | null,
    two_factor_enabled: false,
  });

  const [editedProfile, setEditedProfile] = useState({ ...profile });

  useEffect(() => {
    loadProfile();
  }, [userId]);

  const loadProfile = async () => {
    // Fast path: show cached user data immediately so the screen never feels empty
    try {
      const cached = localStorage.getItem('borderpay_user');
      if (cached) {
        const u = JSON.parse(cached);
        const cachedData = {
          full_name: u.full_name || '',
          email: u.email || '',
          phone: u.phone || '',
          address: u.address || '',
          city: u.city || '',
          country: u.country || '',
          postal_code: u.postal_code || '',
          date_of_birth: u.date_of_birth || '',
          kyc_status: u.kyc_status || 'pending',
          account_type: u.account_type || 'individual',
          is_unlocked: u.is_unlocked || false,
          email_confirmed: u.email_confirmed || false,
          last_sign_in_at: u.last_sign_in_at || null,
          created_at: u.created_at || '',
          profile_picture_url: u.profile_picture_url || null,
          two_factor_enabled: u.two_factor_enabled || false,
        };
        setProfile(cachedData);
        setEditedProfile(cachedData);
        setLoading(false);
      }
    } catch (_) { /* ignore parse errors */ }

    // Then fetch fresh data from backend silently
    try {
      const result = await backendAPI.user.getProfile();

      if (result.success && result.data?.user) {
        const u = result.data.user;
        const profileData = {
          full_name: u.full_name || '',
          email: u.email || '',
          phone: u.phone || '',
          address: u.address || '',
          city: u.city || '',
          country: u.country || '',
          postal_code: u.postal_code || '',
          date_of_birth: u.date_of_birth || '',
          kyc_status: u.kyc_status || 'pending',
          account_type: u.account_type || 'individual',
          is_unlocked: u.is_unlocked || false,
          email_confirmed: u.email_confirmed || false,
          last_sign_in_at: u.last_sign_in_at || null,
          created_at: u.created_at || '',
          profile_picture_url: u.profile_picture_url || null,
          two_factor_enabled: u.two_factor_enabled || false,
        };
        setProfile(profileData);
        setEditedProfile(profileData);
        // Update cache for next time
        localStorage.setItem('borderpay_user', JSON.stringify(u));
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
      if (result.success && result.data?.data?.profile_picture_url) {
        setProfile((p) => ({ ...p, profile_picture_url: result.data.data.profile_picture_url }));
        setEditedProfile((p) => ({ ...p, profile_picture_url: result.data.data.profile_picture_url }));
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
    switch (profile.kyc_status) {
      case 'verified':
        return { label: t('profile.verified'), color: 'text-[#C7FF00]', bg: 'bg-[#C7FF00]/10 border-[#C7FF00]/20' };
      case 'reviewing':
        return { label: t('profile.underReview'), color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/20' };
      case 'pending':
        return { label: t('profile.unverified'), color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/20' };
      default:
        return { label: t('profile.notStarted'), color: 'text-gray-400', bg: 'bg-gray-400/10 border-gray-400/20' };
    }
  };

  const kycBadge = getKycBadge();

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

      {/* Header */}
      <div className={`sticky top-0 z-10 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-6 py-4 pt-safe">
          <button
            onClick={onBack}
            className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}
          >
            <ArrowLeft size={20} className={tc.text} />
          </button>
          <h1 className={`bp-text-h3 font-bold ${tc.text}`}>{t('profile.title')}</h1>
          <button
            onClick={() => (editing ? handleCancel() : setEditing(true))}
            className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center ${tc.hoverBg} transition-colors`}
            disabled={saving}
          >
            {editing ? <X size={20} className={tc.text} /> : <Edit2 size={20} className={tc.text} />}
          </button>
        </div>
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
                    {profile.full_name?.charAt(0)?.toUpperCase() || 'U'}
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

          <h2 className="text-xl font-bold text-white">{profile.full_name || 'No Name'}</h2>
          <p className="text-gray-400 text-sm mt-0.5">{profile.email}</p>

          <div className={`flex items-center gap-2 mt-2 px-3 py-1.5 border rounded-full ${kycBadge.bg}`}>
            <ShieldCheck className={`w-4 h-4 ${kycBadge.color}`} />
            <span className={`text-xs font-semibold ${kycBadge.color}`}>{kycBadge.label}</span>
          </div>
        </div>

        {/* Personal Info */}
        <div className="space-y-3">
          <h3 className="text-xs text-gray-400 font-semibold uppercase tracking-wider px-1">Personal Information</h3>

          <ProfileField
            icon={User}
            label="Full Name"
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
            value={editing ? editedProfile.address : profile.address}
            editing={editing}
            onChange={(value) => setEditedProfile({ ...editedProfile, address: value })}
          />

          <div className="grid grid-cols-2 gap-3">
            <ProfileField
              icon={MapPin}
              label="City"
              value={editing ? editedProfile.city : profile.city}
              editing={editing}
              onChange={(value) => setEditedProfile({ ...editedProfile, city: value })}
            />
            <ProfileField
              icon={MapPin}
              label="Postal Code"
              value={editing ? editedProfile.postal_code : profile.postal_code}
              editing={editing}
              onChange={(value) => setEditedProfile({ ...editedProfile, postal_code: value })}
            />
          </div>

          <ProfileField
            icon={Globe}
            label="Country"
            value={editing ? editedProfile.country : profile.country}
            editing={false}
            disabled
          />
        </div>

        {/* Account Status */}
        <div className="space-y-3">
          <h3 className="text-xs text-gray-400 font-semibold uppercase tracking-wider px-1">Account Status</h3>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
            <StatusRow label="Account Type" value={profile.account_type === 'business' ? 'Business' : 'Individual'} />
            <StatusRow
              label="Wallet Access"
              value={profile.is_unlocked ? 'Activated' : 'Locked'}
              valueColor={profile.is_unlocked ? 'text-[#C7FF00]' : 'text-orange-400'}
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