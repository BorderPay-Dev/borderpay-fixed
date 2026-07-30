/**
 * ExternalCryptoWithdrawalFields — external stablecoin withdrawal form.
 *
 * Replaces the old bank/mobile-money African payout form. African corridors now
 * settle as native external stablecoin transfers (USDT/USDC) over a supported
 * network. Captures:
 *   • Network (TRON/TRC-20, Base)
 *   • Token (USDT / USDC, route-bound)
 *   • External destination address (validated per network family)
 *
 * Controlled/presentational; the parent payout flow owns state + submission.
 * Provider-agnostic (no provider name surfaced).
 */

import React from 'react';
import { Wallet, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

export type CryptoNetwork = 'tron' | 'base';
export type CryptoToken   = 'USDT' | 'USDC';

export interface CryptoWithdrawalValues {
  network: CryptoNetwork;
  token:   CryptoToken;
  address: string;
}

interface NetworkDef {
  id:     CryptoNetwork;
  label:  string;
  family: 'evm' | 'tron' | 'solana';
  /** Tokens available on this network. */
  tokens: CryptoToken[];
}

export const NETWORKS: NetworkDef[] = [
  { id: 'tron',     label: 'TRON (TRC-20)',     family: 'tron',   tokens: ['USDT'] },
  { id: 'base',     label: 'Base',              family: 'evm',    tokens: ['USDC'] },
];

const ADDRESS_RULES: Record<NetworkDef['family'], { re: RegExp; hint: string }> = {
  evm:    { re: /^0x[a-fA-F0-9]{40}$/,             hint: '0x… (42 chars)' },
  tron:   { re: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,     hint: 'T… (34 chars)' },
  solana: { re: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,   hint: 'base58 (32–44 chars)' },
};

/** True if `address` is a valid crypto address for the chosen network. */
export function isValidCryptoAddress(network: CryptoNetwork, address: string): boolean {
  const def = NETWORKS.find((n) => n.id === network);
  if (!def) return false;
  return ADDRESS_RULES[def.family].re.test(String(address || '').trim());
}

interface Props {
  values:   CryptoWithdrawalValues;
  onChange: (patch: Partial<CryptoWithdrawalValues>) => void;
  readOnly?: boolean;
  routeLabel?: string;
}

export function ExternalCryptoWithdrawalFields({ values, onChange, readOnly = false, routeLabel }: Props) {
  const tc = useThemeClasses();
  const def = NETWORKS.find((n) => n.id === values.network) || NETWORKS[0];
  const addr = (values.address || '').trim();
  const valid = addr.length === 0 ? null : isValidCryptoAddress(values.network, addr);

  return (
    <div className="space-y-3">
      {/* Network */}
      <label className="block">
        <span className={`block text-[11px] font-semibold uppercase tracking-wider ${tc.textMuted} mb-1.5`}>Network</span>
        <select
          value={values.network}
          disabled={readOnly}
          onChange={(e) => {
            const next = e.target.value as CryptoNetwork;
            const nd = NETWORKS.find((n) => n.id === next)!;
            // keep token valid for the new network
            const token = nd.tokens.includes(values.token) ? values.token : nd.tokens[0];
            onChange({ network: next, token });
          }}
          className={`w-full h-11 px-3 rounded-xl border ${tc.inputBg} text-sm outline-none disabled:opacity-70`}
        >
          {NETWORKS.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
      </label>

      {/* Token */}
      <label className="block">
        <span className={`block text-[11px] font-semibold uppercase tracking-wider ${tc.textMuted} mb-1.5`}>Token</span>
        <div className="flex gap-2">
          {def.tokens.map((t) => {
            const active = values.token === t;
            return (
              <button
                key={t}
                type="button"
                disabled={readOnly}
                onClick={() => onChange({ token: t })}
                className={`flex-1 h-10 rounded-xl text-sm font-semibold transition-colors disabled:opacity-70 ${
                  active ? 'bg-[#C7FF00] text-black' : `${tc.card} ${tc.cardBorder} border ${tc.text}`
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </label>

      {/* Destination address */}
      <label className="block">
        <span className={`block text-[11px] font-semibold uppercase tracking-wider ${tc.textMuted} mb-1.5`}>
          Destination address
        </span>
        <div className="relative">
          <Wallet className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${tc.textMuted}`} />
          <input
            value={values.address}
            readOnly={readOnly}
            onChange={(e) => onChange({ address: e.target.value })}
            placeholder={readOnly ? 'Saved withdrawal wallet address' : `Paste the recipient ${def.label} address`}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className={`w-full h-11 pl-9 pr-9 rounded-xl border ${tc.inputBg} text-sm font-mono outline-none ${
              valid === false ? 'border-red-500/60' : ''
            }`}
          />
          {valid !== null && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              {valid
                ? <CheckCircle2 className="w-4 h-4 text-[#C7FF00]" />
                : <AlertCircle className="w-4 h-4 text-red-400" />}
            </span>
          )}
        </div>
        <span className={`block text-[11px] mt-1 ${valid === false ? 'text-red-400' : tc.textMuted}`}>
          {valid === false
            ? `Invalid address for ${def.label}. Expected ${ADDRESS_RULES[def.family].hint}.`
            : readOnly
              ? routeLabel || `BorderPay route for ${values.token} on ${def.label}.`
              : `Send only ${values.token} on ${def.label}. Wrong-network transfers are unrecoverable.`}
        </span>
      </label>
    </div>
  );
}

export default ExternalCryptoWithdrawalFields;
