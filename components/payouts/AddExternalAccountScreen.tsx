/**
 * AddExternalAccountScreen — add a fiat payout (offramp) destination.
 *
 * v1 supports Bridge-documented external-account types:
 *   • US bank account (USD) — ACH / ACH same-day / Wire all settle here;
 *     the rail is chosen later at transfer time.
 *   • IBAN (EUR) — SEPA.
 *   • CLABE (MXN) — SPEI.
 *   • Pix (BRL) — Pix key or BR code.
 *
 * Reached only when EXTERNAL_ACCOUNTS_LIVE is true (gated in MainApp).
 * Submits to the `bridge-external-account` edge function via
 * backendAPI.bridge.externalAccount.create. No funds move here — this only
 * registers a destination Bridge can later pay out to.
 *
 * Copy rule: Bridge owns verification + payout rails. African local
 * currencies / mobile money are NOT offered here — they are BorderPay
 * partner rails, gated separately.
 */

import React, { useEffect, useRef, useState } from 'react';
import { friendlyError } from '../../utils/errors/friendlyError';
import { Banknote, Loader2, Building2, User as UserIcon } from 'lucide-react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { authAPI } from '../../utils/supabase/client';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { financialCacheKey } from '../../utils/financial/cacheScope';
import { useBridgeScaAction } from '../../utils/security/useBridgeScaAction';

type AccountType = 'us' | 'iban' | 'gb';
const DEFAULT_ACCOUNT_TYPES: Array<AccountType> = ['us', 'iban', 'gb'];

interface AddExternalAccountScreenProps {
  onBack: () => void;
  onAdded?: () => void;
}

export function AddExternalAccountScreen({ onBack, onAdded }: AddExternalAccountScreenProps) {
  const tc = useThemeClasses();
  const { authorize: authorizeBridgeSca, challenge: scaChallenge } = useBridgeScaAction();
  const userId = (authAPI.getStoredUser()?.id as string) || '';
  const sendCapsCacheKey = financialCacheKey('borderpay_send_caps_v1', { userId });
  const readCachedCapabilities = (): Array<AccountType> => {
    try {
      const raw = localStorage.getItem(sendCapsCacheKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const types = Array.isArray(parsed) ? parsed : [];
      return types.filter((x: any) => x === 'us' || x === 'iban' || x === 'gb');
    } catch {
      return [];
    }
  };
  const cachedCapabilities = readCachedCapabilities();
  const initialCapabilityTypes = cachedCapabilities.length > 0 ? cachedCapabilities : DEFAULT_ACCOUNT_TYPES;
  const [supportedAccountTypes, setSupportedAccountTypes] = useState<Array<AccountType>>(initialCapabilityTypes);
  const supportedAccountTypesRef = useRef<Array<AccountType>>(initialCapabilityTypes);
  const capabilityLoadInFlightRef = useRef<Promise<void> | null>(null);
  const capabilityRefreshTsKey = financialCacheKey('borderpay_external_account_capabilities_refresh_ts_v1', { userId });
  const defaultType: AccountType = supportedAccountTypes[0] || 'us';
  const [accountType, setAccountType] = useState<AccountType>(defaultType);
  const [submitting, setSubmitting] = useState(false);

  // Shared
  const [ownerName, setOwnerName] = useState('');
  const [bankName, setBankName]   = useState('');

  // US
  const [accountNumber, setAccountNumber] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [usAccountClass, setUsAccountClass] = useState<'checking' | 'savings'>('checking');
  const [street, setStreet]   = useState('');
  const [city, setCity]       = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [postal, setPostal]   = useState('');
  const [country, setCountry] = useState('US');

  // IBAN
  const [ownerType, setOwnerType] = useState<'individual' | 'business'>('individual');
  const [iban, setIban]       = useState('');
  const [bic, setBic]         = useState('');
  const [ibanCountry, setIbanCountry] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [businessName, setBusinessName] = useState('');
  // GB
  const [sortCode, setSortCode] = useState('');
  const [gbAccountNumber, setGbAccountNumber] = useState('');

  useEffect(() => {
    supportedAccountTypesRef.current = supportedAccountTypes;
  }, [supportedAccountTypes]);

  useEffect(() => {
    const prewarmKey = `borderpay_add_external_account_prewarm_v1:${userId}`;
    try {
      const last = Number(sessionStorage.getItem(prewarmKey) || '0');
      if (!Number.isFinite(last) || Date.now() - last >= 180_000) {
        const prefetch = (window as any).__borderpay_prefetch;
        if (typeof prefetch === 'function') {
          const warm = () => {
            ['external-accounts', 'send-money', 'wallet-detail', 'settings'].forEach((s) => {
              try { prefetch(s); } catch { /* noop */ }
            });
          };
          const ric = (window as any).requestIdleCallback;
          if (typeof ric === 'function') ric(warm, { timeout: 1000 });
          else setTimeout(warm, 120);
        }
        sessionStorage.setItem(prewarmKey, String(Date.now()));
      }
    } catch { /* noop */ }

    const loadCapabilities = async (force = false) => {
      if (capabilityLoadInFlightRef.current) {
        await capabilityLoadInFlightRef.current;
        return;
      }
      const run = (async () => {
      const seeded = supportedAccountTypesRef.current.length > 0 ? supportedAccountTypesRef.current : initialCapabilityTypes;
      try {
        const last = Number(localStorage.getItem(capabilityRefreshTsKey) || '0');
        if (!force && seeded.length > 0 && Number.isFinite(last) && Date.now() - last < 60_000) return;
      } catch { /* noop */ }
      try {
        const r: any = await backendAPI.financial.getSnapshot(50);
        if (r?.success) {
          const types = Array.isArray(r?.data?.external_account_capabilities) ? r.data.external_account_capabilities : [];
          const filtered = types.filter((x: any) => x === 'us' || x === 'iban' || x === 'gb');
          setSupportedAccountTypes(filtered.length > 0 ? filtered : cachedCapabilities);
          if (filtered.length > 0) {
            try { localStorage.setItem(sendCapsCacheKey, JSON.stringify(filtered)); } catch { /* noop */ }
            try { localStorage.setItem(capabilityRefreshTsKey, String(Date.now())); } catch { /* noop */ }
          }
          if (filtered.length > 0) setAccountType(filtered[0] as AccountType);
        } else if (seeded.length === 0) {
          // Keep screen interactive with cached/default options on transient timeout.
          setSupportedAccountTypes(initialCapabilityTypes);
          setAccountType((prev) => prev || (initialCapabilityTypes[0] || 'us'));
        }
      } catch {
        // Keep cached capabilities on transient network failures.
        if (seeded.length === 0) {
          setSupportedAccountTypes(initialCapabilityTypes);
          setAccountType((prev) => prev || (initialCapabilityTypes[0] || 'us'));
        }
      }
      })();
      capabilityLoadInFlightRef.current = run;
      try {
        await run;
      } finally {
        if (capabilityLoadInFlightRef.current === run) {
          capabilityLoadInFlightRef.current = null;
        }
      }
    };

    void loadCapabilities();
    const onFocus = () => { void loadCapabilities(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadCapabilities();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, capabilityRefreshTsKey]);

  const submit = async () => {
    if (!ownerName.trim()) { toast.error('Account holder name is required.'); return; }
    try {
      let account: any;
      if (accountType === 'us') {
        if (!accountNumber.trim() || !routingNumber.trim()) {
          toast.error('Account number and routing number are required.'); setSubmitting(false); return;
        }
        if (!street.trim() || !city.trim() || !postal.trim() || !country.trim()) {
          toast.error('A full billing address is required for US accounts.'); setSubmitting(false); return;
        }
        account = {
          account_type: 'us',
          account_owner_name: ownerName.trim(),
          account_number: accountNumber.trim(),
          routing_number: routingNumber.trim(),
          checking_or_savings: usAccountClass,
          ...(bankName.trim() ? { bank_name: bankName.trim() } : {}),
          address: {
            street_line_1: street.trim(),
            city: city.trim(),
            ...(stateRegion.trim() ? { state: stateRegion.trim() } : {}),
            postal_code: postal.trim(),
            country: country.trim().toUpperCase(),
          },
        };
      } else if (accountType === 'iban') {
        if (!iban.trim() || !bic.trim() || !ibanCountry.trim()) {
          toast.error('IBAN, BIC/SWIFT, and IBAN country are required.'); setSubmitting(false); return;
        }
        if (ownerType === 'individual' && (!firstName.trim() || !lastName.trim())) {
          toast.error('First and last name are required.'); setSubmitting(false); return;
        }
        if (ownerType === 'business' && !businessName.trim()) {
          toast.error('Business name is required.'); setSubmitting(false); return;
        }
        account = {
          account_type: 'iban',
          account_owner_name: ownerName.trim(),
          account_owner_type: ownerType,
          iban_number: iban.trim().replace(/\s+/g, ''),
          bic_swift: bic.trim().replace(/\s+/g, ''),
          iban_country: ibanCountry.trim().toUpperCase(),
          ...(bankName.trim() ? { bank_name: bankName.trim() } : {}),
          ...(ownerType === 'individual'
            ? { first_name: firstName.trim(), last_name: lastName.trim() }
            : { business_name: businessName.trim() }),
        };
      } else if (accountType === 'gb') {
        if (!sortCode.trim() || !gbAccountNumber.trim()) {
          toast.error('Sort code and account number are required.'); setSubmitting(false); return;
        }
        if (ownerType === 'individual' && (!firstName.trim() || !lastName.trim())) {
          toast.error('First and last name are required.'); setSubmitting(false); return;
        }
        if (ownerType === 'business' && !businessName.trim()) {
          toast.error('Business name is required.'); setSubmitting(false); return;
        }
        account = {
          account_type: 'gb',
          account_owner_name: ownerName.trim(),
          account_owner_type: ownerType,
          ...(bankName.trim() ? { bank_name: bankName.trim() } : {}),
          account: {
            sort_code: sortCode.trim().replace(/\s+/g, ''),
            account_number: gbAccountNumber.trim().replace(/\s+/g, ''),
          },
          ...(ownerType === 'individual'
            ? { first_name: firstName.trim(), last_name: lastName.trim() }
            : { business_name: businessName.trim() }),
        };
      } else {
        toast.error('Unsupported payout account type.');
        setSubmitting(false);
        return;
      }

      const authorizationId = await authorizeBridgeSca({
        operation: 'beneficiary_change',
        resource: 'bridge_external_account',
        request: { action: 'create', account },
        title: 'Confirm payout account',
        description: 'Verify this beneficiary change with your account password and authenticator code.',
      });
      await createAuthorized(account, authorizationId);
    } catch (e: any) {
      toast.error(friendlyError(e, 'Could not add the payout account.'));
    } finally {
      setSubmitting(false);
    }
  };

  const createAuthorized = async (account: any, authorizationId: string) => {
    setSubmitting(true);
    try {
      const res: any = await backendAPI.bridge.externalAccount.create(account, authorizationId);
      if (res?.success) {
        toast.success('Payout account added.');
        onAdded?.();
        onBack();
      } else toast.error(res?.error || 'Could not add the payout account.');
    } catch (e: any) {
      toast.error(friendlyError(e, 'Could not add the payout account.'));
    } finally {
      setSubmitting(false);
    }
  };

  const field = `w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm ${tc.text} focus:outline-none focus:border-[#C7FF00]/40`;
  const label = `block text-xs ${tc.textMuted} uppercase tracking-[0.12em] font-semibold mb-1.5`;
  const canUseUs = supportedAccountTypes.includes('us');
  const canUseIban = supportedAccountTypes.includes('iban');
  const canUseGb = supportedAccountTypes.includes('gb');
  const canUseExternalAccounts = supportedAccountTypes.length > 0;

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <FloatingBackButton onBack={onBack} />
      <header
        className="flex items-center gap-3 pl-16 pr-5 sm:pr-6 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.85rem)' }}
      >
        <h1 className={`text-base font-semibold ${tc.text}`}>Add payout account</h1>
      </header>

      <main className="px-5 sm:px-6 pb-10 max-w-md mx-auto space-y-4">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <Banknote className="w-5 h-5 text-[#C7FF00]" />
          <p className={`text-xs ${tc.textMuted} leading-relaxed`}>
            Add a bank account you own to receive payouts through BorderPay.
          </p>
        </div>

        {/* Account type */}
        <div>
          <label className={label}>Account type</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setAccountType('us')} disabled={!canUseUs}
              className={`py-3 rounded-xl border text-sm font-semibold ${
                !canUseUs
                  ? `bg-white/[0.02] ${tc.textMuted} border-white/10 opacity-50 cursor-not-allowed`
                  : accountType === 'us'
                    ? 'bg-[#C7FF00] text-black border-[#C7FF00]'
                    : `bg-white/[0.04] ${tc.text} border-white/10`
              }`}>
              US bank (USD)
            </button>
            <button type="button" onClick={() => setAccountType('iban')} disabled={!canUseIban}
              className={`py-3 rounded-xl border text-sm font-semibold ${
                !canUseIban
                  ? `bg-white/[0.02] ${tc.textMuted} border-white/10 opacity-50 cursor-not-allowed`
                  : accountType === 'iban'
                    ? 'bg-[#C7FF00] text-black border-[#C7FF00]'
                    : `bg-white/[0.04] ${tc.text} border-white/10`
              }`}>
              IBAN (EUR)
            </button>
            <button type="button" onClick={() => setAccountType('gb')} disabled={!canUseGb}
              className={`py-3 rounded-xl border text-sm font-semibold ${
                !canUseGb
                  ? `bg-white/[0.02] ${tc.textMuted} border-white/10 opacity-50 cursor-not-allowed`
                  : accountType === 'gb'
                    ? 'bg-[#C7FF00] text-black border-[#C7FF00]'
                    : `bg-white/[0.04] ${tc.text} border-white/10`
              }`}>
              UK bank (GBP)
            </button>
          </div>
          <p className={`text-[11px] ${tc.textMuted} mt-1.5`}>
            {accountType === 'us'
              ? 'Supports ACH, ACH same-day, and Wire payouts.'
              : accountType === 'iban'
                ? 'Supports SEPA payouts.'
                : 'Supports Faster Payments payouts.'}
          </p>
          {!canUseExternalAccounts && (
            <p className={`text-[11px] text-amber-300 mt-2`}>
              External bank accounts are currently unavailable on your profile.
            </p>
          )}
        </div>

        <div>
          <label className={label}>Account holder name</label>
          <input className={field} value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="As it appears on the account" />
        </div>
        <div>
          <label className={label}>Bank name (optional)</label>
          <input className={field} value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. Chase, Revolut" />
        </div>

        {accountType === 'us' ? (
          <>
            <div>
              <label className={label}>Account class</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setUsAccountClass('checking')}
                  className={`py-2.5 rounded-xl border text-sm font-semibold ${usAccountClass === 'checking' ? 'bg-[#C7FF00] text-black border-[#C7FF00]' : `bg-white/[0.04] ${tc.text} border-white/10`}`}>
                  Checking
                </button>
                <button type="button" onClick={() => setUsAccountClass('savings')}
                  className={`py-2.5 rounded-xl border text-sm font-semibold ${usAccountClass === 'savings' ? 'bg-[#C7FF00] text-black border-[#C7FF00]' : `bg-white/[0.04] ${tc.text} border-white/10`}`}>
                  Savings
                </button>
              </div>
            </div>
            <div>
              <label className={label}>Account number</label>
              <input className={field} value={accountNumber} onChange={e => setAccountNumber(e.target.value)} inputMode="numeric" />
            </div>
            <div>
              <label className={label}>Routing number</label>
              <input className={field} value={routingNumber} onChange={e => setRoutingNumber(e.target.value)} inputMode="numeric" />
            </div>
            <div>
              <label className={label}>Billing address</label>
              <input className={`${field} mb-2`} value={street} onChange={e => setStreet(e.target.value)} placeholder="Street address" />
              <div className="grid grid-cols-2 gap-2">
                <input className={field} value={city} onChange={e => setCity(e.target.value)} placeholder="City" />
                <input className={field} value={stateRegion} onChange={e => setStateRegion(e.target.value)} placeholder="State (optional)" />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <input className={field} value={postal} onChange={e => setPostal(e.target.value)} placeholder="Postal code" />
                <input className={field} value={country} onChange={e => setCountry(e.target.value)} placeholder="Country (ISO-2)" maxLength={2} />
              </div>
            </div>
          </>
        ) : accountType === 'iban' ? (
          <>
            <div>
              <label className={label}>Account owner type</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setOwnerType('individual')}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium ${ownerType === 'individual' ? 'bg-[#C7FF00] text-black border-[#C7FF00]' : `bg-white/[0.04] ${tc.text} border-white/10`}`}>
                  <UserIcon className="w-4 h-4" /> Individual
                </button>
                <button type="button" onClick={() => setOwnerType('business')}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium ${ownerType === 'business' ? 'bg-[#C7FF00] text-black border-[#C7FF00]' : `bg-white/[0.04] ${tc.text} border-white/10`}`}>
                  <Building2 className="w-4 h-4" /> Business
                </button>
              </div>
            </div>
            {ownerType === 'individual' ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>First name</label>
                  <input className={field} value={firstName} onChange={e => setFirstName(e.target.value)} />
                </div>
                <div>
                  <label className={label}>Last name</label>
                  <input className={field} value={lastName} onChange={e => setLastName(e.target.value)} />
                </div>
              </div>
            ) : (
              <div>
                <label className={label}>Business name</label>
                <input className={field} value={businessName} onChange={e => setBusinessName(e.target.value)} />
              </div>
            )}
            <div>
              <label className={label}>IBAN</label>
              <input className={field} value={iban} onChange={e => setIban(e.target.value)} placeholder="e.g. DE89 3704 0044 0532 0130 00" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>BIC / SWIFT</label>
                <input className={field} value={bic} onChange={e => setBic(e.target.value)} />
              </div>
              <div>
                <label className={label}>IBAN country (ISO-2)</label>
                <input className={field} value={ibanCountry} onChange={e => setIbanCountry(e.target.value)} maxLength={2} placeholder="DE" />
              </div>
            </div>
          </>
        ) : accountType === 'gb' ? (
          <>
            <div>
              <label className={label}>Account owner type</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setOwnerType('individual')}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium ${ownerType === 'individual' ? 'bg-[#C7FF00] text-black border-[#C7FF00]' : `bg-white/[0.04] ${tc.text} border-white/10`}`}>
                  <UserIcon className="w-4 h-4" /> Individual
                </button>
                <button type="button" onClick={() => setOwnerType('business')}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium ${ownerType === 'business' ? 'bg-[#C7FF00] text-black border-[#C7FF00]' : `bg-white/[0.04] ${tc.text} border-white/10`}`}>
                  <Building2 className="w-4 h-4" /> Business
                </button>
              </div>
            </div>
            {ownerType === 'individual' ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>First name</label>
                  <input className={field} value={firstName} onChange={e => setFirstName(e.target.value)} />
                </div>
                <div>
                  <label className={label}>Last name</label>
                  <input className={field} value={lastName} onChange={e => setLastName(e.target.value)} />
                </div>
              </div>
            ) : (
              <div>
                <label className={label}>Business name</label>
                <input className={field} value={businessName} onChange={e => setBusinessName(e.target.value)} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>Sort code</label>
                <input className={field} value={sortCode} onChange={e => setSortCode(e.target.value)} inputMode="numeric" placeholder="6 digits" />
              </div>
              <div>
                <label className={label}>Account number</label>
                <input className={field} value={gbAccountNumber} onChange={e => setGbAccountNumber(e.target.value)} inputMode="numeric" placeholder="8 digits" />
              </div>
            </div>
          </>
        ) : null}

        <button
          onClick={submit}
          disabled={submitting || !canUseExternalAccounts}
          className="w-full py-3.5 rounded-2xl bg-[#C7FF00] text-black font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 mt-2"
        >
          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Add payout account'}
        </button>
        <button onClick={onBack} className={`w-full py-2.5 text-xs ${tc.textMuted}`}>Cancel</button>
      </main>
      {scaChallenge}
    </div>
  );
}

export default AddExternalAccountScreen;
