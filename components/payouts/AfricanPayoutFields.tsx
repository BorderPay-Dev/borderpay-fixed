/**
 * AfricanPayoutFields (#B2) — dynamic destination fields for African payouts.
 *
 * Switches the form based on the selected method:
 *   • "Bank Account"  → Account Number + Bank Code
 *   • "Mobile Money"  → Phone Number + Network Provider
 *
 * Controlled/presentational; the parent payout flow owns state and submission.
 * Provider-agnostic (no provider name surfaced).
 */

import React from 'react';
import { Landmark, Smartphone } from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

export type AfricanPayoutMethod = 'bank_account' | 'mobile_money';

export interface AfricanPayoutValues {
  method:        AfricanPayoutMethod;
  accountNumber: string;
  bankCode:      string;
  phone:         string;
  network:       string;
}

interface AfricanPayoutFieldsProps {
  values:    AfricanPayoutValues;
  onChange:  (patch: Partial<AfricanPayoutValues>) => void;
  /** Network providers to offer for mobile money (country-dependent). */
  networks?: string[];
}

const DEFAULT_NETWORKS = ['MPESA', 'MTN', 'Airtel', 'Vodafone', 'Orange', 'Tigo'];

export function AfricanPayoutFields({ values, onChange, networks = DEFAULT_NETWORKS }: AfricanPayoutFieldsProps) {
  const tc = useThemeClasses();
  const isBank = values.method === 'bank_account';

  const seg = (m: AfricanPayoutMethod, label: string, Icon: React.ComponentType<{ className?: string }>) => {
    const active = values.method === m;
    return (
      <button
        type="button"
        onClick={() => onChange({ method: m })}
        className={`flex-1 inline-flex items-center justify-center gap-2 h-11 rounded-xl text-sm font-semibold transition-colors ${
          active ? 'bg-[#C7FF00] text-black' : `${tc.card} ${tc.cardBorder} border ${tc.text}`
        }`}
      >
        <Icon className="w-4 h-4" />
        {label}
      </button>
    );
  };

  const field = (label: string, value: string, key: keyof AfricanPayoutValues, placeholder: string, inputMode?: 'numeric' | 'tel') => (
    <label className="block">
      <span className={`block text-[11px] font-semibold uppercase tracking-wider ${tc.textMuted} mb-1.5`}>{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange({ [key]: e.target.value } as Partial<AfricanPayoutValues>)}
        placeholder={placeholder}
        className={`w-full h-11 px-3 rounded-xl border ${tc.inputBg} text-sm outline-none`}
      />
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {seg('bank_account', 'Bank Account', Landmark)}
        {seg('mobile_money', 'Mobile Money', Smartphone)}
      </div>

      {isBank ? (
        <div className="space-y-3">
          {field('Account number', values.accountNumber, 'accountNumber', '0123456789', 'numeric')}
          {field('Bank code', values.bankCode, 'bankCode', 'e.g. 058', 'numeric')}
        </div>
      ) : (
        <div className="space-y-3">
          {field('Phone number', values.phone, 'phone', '+254 7XX XXX XXX', 'tel')}
          <label className="block">
            <span className={`block text-[11px] font-semibold uppercase tracking-wider ${tc.textMuted} mb-1.5`}>Network provider</span>
            <select
              value={values.network}
              onChange={(e) => onChange({ network: e.target.value })}
              className={`w-full h-11 px-3 rounded-xl border ${tc.inputBg} text-sm outline-none`}
            >
              <option value="">Select network</option>
              {networks.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

export default AfricanPayoutFields;
