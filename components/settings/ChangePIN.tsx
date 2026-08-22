/**
 * BorderPay Africa - Change PIN Screen
 * i18n + theme-aware, uses authAPI.getToken()
 */

import React, { useEffect, useState } from 'react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { PINManager } from '../../utils/security/SecurityManager';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { friendlyError } from '../../utils/errors/friendlyError';
import { PINSetup } from '../security/PINSetup';
import { backendAPI } from '../../utils/api/backendAPI';
import { useScaRequirement } from '../../utils/security/useScaRequirement';

interface ChangePINProps {
  userId: string;
  onBack: () => void;
}

export function ChangePIN({ userId, onBack }: ChangePINProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const [loading, setLoading] = useState(false);
  const [showCurrentPIN, setShowCurrentPIN] = useState(false);
  const [showNewPIN, setShowNewPIN] = useState(false);
  const [showConfirmPIN, setShowConfirmPIN] = useState(false);
  const [totp, setTotp] = useState('');
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [setupMode, setSetupMode] = useState(false);
  const scaRequired = useScaRequirement() !== 'not_required';
  
  const [formData, setFormData] = useState({
    currentPIN: '',
    newPIN: '',
    confirmPIN: '',
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res: any = await backendAPI.auth.getSecurityStatus(userId);
        if (!alive) return;
        const pinSet = !!(res?.data?.pin_set ?? res?.pin_set);
        setSetupMode(!pinSet);
      } catch {
        if (!alive) return;
        setSetupMode(!PINManager.hasPIN(userId));
      } finally {
        if (alive) setCheckingStatus(false);
      }
    })();
    return () => { alive = false; };
  }, [userId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.newPIN.length !== 6) {
      toast.error(t('changePin.pinDigits'));
      return;
    }

    if (!/^\d+$/.test(formData.newPIN)) {
      toast.error(t('changePin.pinDigits'));
      return;
    }

    if (formData.newPIN !== formData.confirmPIN) {
      toast.error(t('changePin.pinsNoMatch'));
      return;
    }

    if (formData.currentPIN === formData.newPIN) {
      toast.error('New PIN must be different from current PIN');
      return;
    }

    try {
      setLoading(true);
      if (scaRequired && !/^\d{6}$/.test(totp)) {
        toast.error('Enter your 6-digit authenticator code.');
        return;
      }
      let authorizationId = '';
      if (scaRequired) {
        const authorization: any = await backendAPI.auth.authorizeSCA({
          operation: 'security_change', resource: 'change_pin', request: { action: 'change_pin' },
          pin: formData.currentPIN, totp,
        });
        if (!authorization?.success || !authorization?.data?.authorization_id) {
          toast.error(friendlyError(authorization?.error, 'Strong authentication failed'));
          return;
        }
        authorizationId = authorization.data.authorization_id;
      }
      const result = await PINManager.changePIN(
        userId,
        formData.currentPIN,
        formData.newPIN,
        authorizationId,
      );

      if (result.success) {
        toast.success('PIN changed successfully');
        onBack();
      } else {
        if (/pin not set up/i.test(String(result.error || ''))) {
          setSetupMode(true);
          toast.error('Create your transaction PIN first.');
          return;
        }
        toast.error(friendlyError(result.error, 'Failed to change PIN'));
      }
    } catch (error) {
      toast.error('Failed to change PIN');
    } finally {
      setLoading(false);
    }
  };

  const handlePINInput = (field: 'currentPIN' | 'newPIN' | 'confirmPIN', value: string) => {
    const sanitized = value.replace(/\D/g, '').slice(0, 6);
    setFormData({ ...formData, [field]: sanitized });
  };

  const isPINValid = formData.newPIN.length === 6 && /^\d+$/.test(formData.newPIN);
  const isPINMatch = formData.newPIN === formData.confirmPIN && formData.confirmPIN.length === 6;

  if (checkingStatus) {
    return (
      <div className={`min-h-screen ${tc.bg} ${tc.text} pb-safe`}>
        <FloatingBackButton onBack={onBack} />
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[#C7FF00]" />
        </div>
      </div>
    );
  }

  if (setupMode) {
    return (
      <PINSetup
        userId={userId}
        onBack={onBack}
        onComplete={onBack}
      />
    );
  }

  return (
    <div className={`min-h-screen ${tc.bg} pb-safe`}>
      {/* Header */}
      <FloatingBackButton onBack={onBack} />
      <div className={`${tc.bgAlt} px-6 py-4 pt-safe border-b ${tc.border} sticky top-0 z-10`}>
        <div className="flex items-center gap-3">
          <div className="w-10" />
          <div>
            <h1 className={`${tc.text} bp-text-h3 font-bold`}>{t('changePin.title')}</h1>
            <p className={`${tc.textSecondary} bp-text-small`}>{t('changePin.subtitle')}</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6">
        {/* Current PIN */}
        <div className={`${tc.bgAlt} rounded-3xl border ${tc.border} p-6 space-y-4`}>
          <h2 className={`${tc.text} bp-text-body font-semibold`}>{t('changePin.currentPin')}</h2>
          
          <div className="space-y-2">
            <label htmlFor="currentPIN" className={`${tc.textSecondary} bp-text-small`}>
              {t('changePin.enterCurrent')}
            </label>
            <div className="relative">
              <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${tc.textMuted}`} />
              <input
                id="currentPIN"
                type={showCurrentPIN ? 'text' : 'password'}
                value={formData.currentPIN}
                onChange={(e) => handlePINInput('currentPIN', e.target.value)}
                className={`w-full pl-10 pr-10 py-3 ${tc.inputBg} rounded-xl bp-text-body focus:border-[#C7FF00] focus:outline-none transition-colors`}
                placeholder="\u2022\u2022\u2022\u2022\u2022\u2022"
                maxLength={6}
                inputMode="numeric"
                pattern="\d*"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPIN(!showCurrentPIN)}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${tc.textMuted} hover:${tc.text}`}
              >
                {showCurrentPIN ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* New PIN */}
        <div className={`${tc.bgAlt} rounded-3xl border ${tc.border} p-6 space-y-4`}>
          <h2 className={`${tc.text} bp-text-body font-semibold`}>{t('changePin.newPin')}</h2>
          
          <div className="space-y-2">
            <label htmlFor="newPIN" className={`${tc.textSecondary} bp-text-small`}>
              {t('changePin.enterNew')}
            </label>
            <div className="relative">
              <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${tc.textMuted}`} />
              <input
                id="newPIN"
                type={showNewPIN ? 'text' : 'password'}
                value={formData.newPIN}
                onChange={(e) => handlePINInput('newPIN', e.target.value)}
                className={`w-full pl-10 pr-10 py-3 ${tc.inputBg} rounded-xl bp-text-body focus:border-[#C7FF00] focus:outline-none transition-colors`}
                placeholder="\u2022\u2022\u2022\u2022\u2022\u2022"
                maxLength={6}
                inputMode="numeric"
                pattern="\d*"
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPIN(!showNewPIN)}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${tc.textMuted} hover:${tc.text}`}
              >
                {showNewPIN ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {formData.newPIN.length > 0 && (
              <div className="flex items-center gap-2 pt-2">
                {isPINValid ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-[#C7FF00]" />
                    <span className="text-[#C7FF00] bp-text-small">{t('changePin.validFormat')}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-yellow-500" />
                    <span className="text-yellow-500 bp-text-small">
                      {t('changePin.pinDigits')} ({formData.newPIN.length}/6)
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2">
            <label htmlFor="confirmPIN" className={`${tc.textSecondary} bp-text-small`}>
              {t('changePin.confirmNew')}
            </label>
            <div className="relative">
              <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${tc.textMuted}`} />
              <input
                id="confirmPIN"
                type={showConfirmPIN ? 'text' : 'password'}
                value={formData.confirmPIN}
                onChange={(e) => handlePINInput('confirmPIN', e.target.value)}
                className={`w-full pl-10 pr-10 py-3 ${tc.inputBg} rounded-xl bp-text-body focus:border-[#C7FF00] focus:outline-none transition-colors`}
                placeholder="\u2022\u2022\u2022\u2022\u2022\u2022"
                maxLength={6}
                inputMode="numeric"
                pattern="\d*"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPIN(!showConfirmPIN)}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${tc.textMuted} hover:${tc.text}`}
              >
                {showConfirmPIN ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {formData.confirmPIN.length === 6 && (
              <div className="flex items-center gap-2">
                {isPINMatch ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-[#C7FF00]" />
                    <span className="text-[#C7FF00] bp-text-small">{t('changePin.pinsMatch')}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <span className="text-red-400 bp-text-small">{t('changePin.pinsNoMatch')}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {scaRequired && <div className={`${tc.bgAlt} rounded-3xl border ${tc.border} p-6 space-y-2`}>
          <label htmlFor="change-pin-totp" className={`${tc.textSecondary} bp-text-small`}>
            Authenticator code
          </label>
          <input
            id="change-pin-totp"
            value={totp}
            onChange={(event) => setTotp(event.target.value.replace(/\D/g, '').slice(0, 6))}
            className={`w-full px-4 py-3 ${tc.inputBg} rounded-xl bp-text-body tracking-[0.3em] focus:border-[#C7FF00] focus:outline-none`}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            required
          />
        </div>}

        {/* Security Notice */}
        <div className="bg-[#C7FF00]/10 border border-[#C7FF00]/30 rounded-2xl p-4">
          <p className="text-[#C7FF00] bp-text-small">
            <strong>Security Tip:</strong> {t('changePin.securityTip')}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3 pb-6">
          <Button
            type="submit"
            disabled={loading || !isPINValid || !isPINMatch || formData.currentPIN.length !== 6}
            className="w-full bg-[#C7FF00] hover:bg-[#B8F000] text-black font-bold h-14 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed bp-text-body"
          >
            {loading ? t('changePin.updating') : t('changePin.updatePin')}
          </Button>
          
          <Button
            type="button"
            onClick={onBack}
            className={`w-full ${tc.card} border ${tc.cardBorder} ${tc.text} ${tc.hoverBg} h-12 rounded-xl bp-text-body`}
          >
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}
