/**
 * BorderPay Africa - Change Password Screen
 * i18n + theme-aware
 */

import React, { useState } from 'react';
import { ArrowLeft, Lock, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { supabase } from '../../utils/supabase/client';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { friendlyError } from '../../utils/errors/friendlyError';

interface ChangePasswordProps {
  onBack: () => void;
}

export function ChangePassword({ onBack }: ChangePasswordProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const [loading, setLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [passwordStrength, setPasswordStrength] = useState({
    hasMinLength: false,
    hasUpperCase: false,
    hasLowerCase: false,
    hasNumber: false,
    hasSpecialChar: false,
  });

  const validatePasswordStrength = (password: string) => {
    setPasswordStrength({
      hasMinLength: password.length >= 8,
      hasUpperCase: /[A-Z]/.test(password),
      hasLowerCase: /[a-z]/.test(password),
      hasNumber: /\d/.test(password),
      hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
    });
  };

  const handleNewPasswordChange = (value: string) => {
    setFormData({ ...formData, newPassword: value });
    validatePasswordStrength(value);
  };

  const isPasswordStrong = Object.values(passwordStrength).every(Boolean);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isPasswordStrong) {
      toast.error('Password does not meet security requirements');
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      toast.error(t('changePassword.noMatch'));
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase.auth.updateUser({
        password: formData.newPassword
      });

      if (error) {
        toast.error(friendlyError(error));
        return;
      }

      toast.success('Password changed successfully');
      onBack();
    } catch (error) {
      toast.error('Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  const strengthChecks = [
    { key: 'hasMinLength', label: t('changePassword.minLength') },
    { key: 'hasUpperCase', label: t('changePassword.uppercase') },
    { key: 'hasLowerCase', label: t('changePassword.lowercase') },
    { key: 'hasNumber', label: t('changePassword.number') },
    { key: 'hasSpecialChar', label: t('changePassword.specialChar') },
  ];

  return (
    <div className={`min-h-screen ${tc.bg} pb-safe`}>
      {/* Header */}
      <div className={`${tc.bgAlt} px-4 py-4 pt-safe border-b ${tc.border} sticky top-0 z-10`}>
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className={`p-2 ${tc.hoverBg} rounded-xl transition-colors`}
          >
            <ArrowLeft className={`w-5 h-5 ${tc.text}`} />
          </button>
          <div>
            <h1 className={`${tc.text} bp-text-h3 font-bold`}>{t('changePassword.title')}</h1>
            <p className={`${tc.textSecondary} bp-text-small`}>{t('changePassword.subtitle')}</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="px-4 py-6 space-y-6">
        {/* Current Password */}
        <div className={`${tc.bgAlt} rounded-3xl border ${tc.border} p-6 space-y-4`}>
          <h2 className={`${tc.text} bp-text-body font-semibold`}>{t('changePassword.currentPassword')}</h2>
          
          <div className="space-y-2">
            <Label htmlFor="currentPassword" className={`${tc.textSecondary} bp-text-small`}>
              {t('changePassword.enterCurrent')}
            </Label>
            <div className="relative">
              <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${tc.textMuted}`} />
              <Input
                id="currentPassword"
                type={showCurrentPassword ? 'text' : 'password'}
                value={formData.currentPassword}
                onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                className={`pl-10 pr-10 ${tc.inputBg}`}
                placeholder={t('changePassword.enterCurrent')}
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${tc.textMuted}`}
              >
                {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* New Password */}
        <div className={`${tc.bgAlt} rounded-3xl border ${tc.border} p-6 space-y-4`}>
          <h2 className={`${tc.text} bp-text-body font-semibold`}>{t('changePassword.newPassword')}</h2>
          
          <div className="space-y-2">
            <Label htmlFor="newPassword" className={`${tc.textSecondary} bp-text-small`}>
              {t('changePassword.enterNew')}
            </Label>
            <div className="relative">
              <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${tc.textMuted}`} />
              <Input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                value={formData.newPassword}
                onChange={(e) => handleNewPasswordChange(e.target.value)}
                className={`pl-10 pr-10 ${tc.inputBg}`}
                placeholder={t('changePassword.enterNew')}
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${tc.textMuted}`}
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Password Strength Indicators */}
          {formData.newPassword && (
            <div className="space-y-2 pt-2">
              <p className={`${tc.textSecondary} bp-text-small font-medium`}>{t('changePassword.requirements')}</p>
              <div className="space-y-1.5">
                {strengthChecks.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <CheckCircle
                      className={`w-4 h-4 ${
                        passwordStrength[key as keyof typeof passwordStrength]
                          ? 'text-[#C7FF00]'
                          : tc.textMuted
                      }`}
                    />
                    <span
                      className={`bp-text-small ${
                        passwordStrength[key as keyof typeof passwordStrength]
                          ? 'text-[#C7FF00]'
                          : tc.textMuted
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <Label htmlFor="confirmPassword" className={`${tc.textSecondary} bp-text-small`}>
              {t('changePassword.confirmNew')}
            </Label>
            <div className="relative">
              <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${tc.textMuted}`} />
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                className={`pl-10 pr-10 ${tc.inputBg}`}
                placeholder={t('changePassword.confirmNew')}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${tc.textMuted}`}
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {formData.confirmPassword && formData.newPassword !== formData.confirmPassword && (
              <p className="text-red-400 bp-text-small">{t('changePassword.noMatch')}</p>
            )}
          </div>
        </div>

        {/* Security Notice */}
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4">
          <p className="text-yellow-300 bp-text-small">
            <strong>Security Tip:</strong> {t('changePassword.securityTip')}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3 pb-6">
          <Button
            type="submit"
            disabled={loading || !isPasswordStrong || formData.newPassword !== formData.confirmPassword}
            className="w-full bg-[#C7FF00] hover:bg-[#B8F000] text-black font-medium h-12 rounded-xl disabled:opacity-50"
          >
            {loading ? t('changePassword.updating') : t('changePassword.updatePassword')}
          </Button>
          
          <Button
            type="button"
            onClick={onBack}
            variant="outline"
            className={`w-full ${tc.border} ${tc.text} ${tc.hoverBg} h-12 rounded-xl`}
          >
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}
