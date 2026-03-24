/**
 * BorderPay Africa - Payment Methods
 * i18n + theme-aware
 */

import React, { useState, useEffect } from 'react';
import { ArrowLeft, CreditCard, Plus, Check, Building2, Smartphone, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { authAPI } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface PaymentMethodsProps {
  onBack: () => void;
}

interface PaymentMethod {
  id: string;
  type: 'bank_transfer' | 'mobile_money';
  label: string;
  details: string;
  is_default: boolean;
}

export function PaymentMethods({ onBack }: PaymentMethodsProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const [loading, setLoading] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  useEffect(() => {
    loadPaymentMethods();
  }, []);

  const loadPaymentMethods = async () => {
    try {
      const user = authAPI.getStoredUser();
      if (!user?.id) {
        return;
      }

      const result = await backendAPI.wallets.getWallets();

      if (result.success && result.data?.length > 0) {
        const methods: PaymentMethod[] = result.data
          .filter((w: any) => w.status === 'active')
          .slice(0, 5)
          .map((w: any, i: number) => ({
            id: w.id,
            type: 'bank_transfer' as const,
            label: `${w.currency} Wallet`,
            details: `Balance: ${getCurrencySymbol(w.currency)}${parseFloat(w.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            is_default: i === 0,
          }));
        setPaymentMethods(methods);
      }
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const getCurrencySymbol = (currency: string) => {
    const symbols: Record<string, string> = {
      USD: '$', NGN: '\u20A6', KES: 'KSh', GHS: '\u20B5',
      TZS: 'TSh', UGX: 'USh', USDT: '$', USDC: '$',
      XOF: 'FCFA', XAF: 'FCFA', PYUSD: '$',
    };
    return symbols[currency] || currency;
  };

  const getMethodIcon = (type: string) => {
    switch (type) {
      case 'bank_transfer': return Building2;
      case 'mobile_money': return Smartphone;
      default: return Wallet;
    }
  };

  return (
    <div className={`min-h-screen ${tc.bg} pb-safe`}>
      {/* Header */}
      <div className={`${tc.bgAlt} px-6 py-4 pt-safe border-b ${tc.border} sticky top-0 z-10`}>
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className={`p-2 ${tc.hoverBg} rounded-xl transition-colors`}
          >
            <ArrowLeft className={`w-5 h-5 ${tc.text}`} />
          </button>
          <div>
            <h1 className={`${tc.text} bp-text-h3 font-bold`}>{t('paymentMethods.title')}</h1>
            <p className={`${tc.textSecondary} bp-text-small`}>{t('paymentMethods.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-4">
        {/* Info Box */}
        <div className="bg-[#C7FF00]/10 border border-[#C7FF00]/20 rounded-2xl p-4">
          <p className="text-[#C7FF00] bp-text-small">
            <strong>How it works:</strong> {t('paymentMethods.howItWorks')}
          </p>
        </div>

        {/* Empty State */}
        {paymentMethods.length === 0 && (
          <div className="text-center py-12">
            <div className={`w-16 h-16 rounded-full ${tc.card} flex items-center justify-center mx-auto mb-4`}>
              <CreditCard className={`w-8 h-8 ${tc.textMuted}`} />
            </div>
            <h3 className={`${tc.text} bp-text-body font-semibold mb-2`}>{t('paymentMethods.noActiveWallets')}</h3>
            <p className={`${tc.textSecondary} bp-text-small`}>
              {t('paymentMethods.activateDesc')}
            </p>
          </div>
        )}

        {/* Payment Methods List */}
        {!loading && paymentMethods.map((method) => {
          const Icon = getMethodIcon(method.type);
          return (
            <div
              key={method.id}
              className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[#C7FF00]/10 flex items-center justify-center">
                    <Icon className="w-6 h-6 text-[#C7FF00]" />
                  </div>
                  <div>
                    <div className={`${tc.text} font-semibold bp-text-body`}>
                      {method.label}
                    </div>
                    <div className={`${tc.textSecondary} bp-text-small mt-0.5`}>
                      {method.details}
                    </div>
                    {method.is_default && (
                      <div className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-[#C7FF00]/20 border border-[#C7FF00]/30 rounded-lg">
                        <Check className="w-3 h-3 text-[#C7FF00]" />
                        <span className="text-[#C7FF00] text-xs font-medium">{t('paymentMethods.primary')}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Add Funding Source */}
        <button
          onClick={() => toast.info(t('paymentMethods.howItWorks'))}
          className={`w-full p-5 ${tc.card} border border-dashed ${tc.border} rounded-2xl hover:border-[#C7FF00]/40 transition-colors`}
        >
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-full ${tc.card} flex items-center justify-center`}>
              <Plus className={`w-6 h-6 ${tc.textSecondary}`} />
            </div>
            <div className="flex-1 text-left">
              <div className={`${tc.text} font-medium bp-text-body`}>{t('paymentMethods.fundWallet')}</div>
              <div className={`${tc.textSecondary} bp-text-small mt-0.5`}>{t('paymentMethods.fundDesc')}</div>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}