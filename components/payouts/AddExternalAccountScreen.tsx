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
import { SkeletonRows } from '../common/Skeleton';
import { financialCacheKey } from '../../utils/financial/cacheScope';

type AccountType = 'us' | 'iban' | 'clabe' | 'pix';

interface AddExternalAccountScreenProps {
  onBack: () => void;
  onAdded?: () => void;
}

export function AddExternalAccountScreen({ onBack, onAdded }: AddExternalAccountScreenProps) {
  const tc = useThemeClasses();
  const userId = (authAPI.getStoredUser()?.id as string) || '';
  const sendCapsCacheKey = financialCacheKey('borderpay_send_caps_v1', { userId });
  const readCachedCapabilities = (): Array<AccountType> => {
    try {
      const raw = localStorage.getItem(sendCapsCacheKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const types = Array.isArray(parsed) ? parsed : [];
      return types.filter((x: any) => x === 'us' || x === 'iban' || x === 'clabe' || x === 'pix');
    } catch {
      return [];
    }
  };
  const cachedCapabilities = readCachedCapabilities();
  const [supportedAccountTypes, setSupportedAccountTypes] = useState<Array<AccountType>>(cachedCapabilities);
  const supportedAccountTypesRef = useRef<Array<AccountType>>(cachedCapabilities);
  const [capabilityLoading, setCapabilityLoading] = useState(cachedCapabilities.length === 0);
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
  // CLABE
  const [clabeNumber, setClabeNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  // Pix
  const [pixMode, setPixMode] = useState<'pix_key' | 'br_code'>('pix_key');
  const [pixKey, setPixKey] = useState('');
  const [brCode, setBrCode] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');

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
          else setTimeout(warm, 220);
        }
        sessionStorage.setItem(prewarmKey, String(Date.now()));
      }
    } catch { /* noop */ }

    const loadCapabilities = async (force = false) => {
      const seeded = supportedAccountTypesRef.current.length > 0 ? supportedAccountTypesRef.current : readCachedCapabilities();
      if (seeded.length === 0) setCapabilityLoading(true);
      try {
        const last = Number(localStorage.getItem(capabilityRefreshTsKey) || '0');
        if (!force && seeded.length > 0 && Number.isFinite(last) && Date.now() - last < 60_000) return;
      } catch { /* noop */ }
      try {
        const r: any = await backendAPI.bridge.externalAccount.capabilities();
        if (r?.success) {
          const types = Array.isArray(r?.data?.supported_account_types) ? r.data.supported_account_types : [];
          const filtered = types.filter((x: any) => x === 'us' || x === 'iban' || x === 'clabe' || x === 'pix');
          setSupportedAccountTypes(filtered.length > 0 ? filtered : cachedCapabilities);
          if (filtered.length > 0) {
            try { localStorage.setItem(sendCapsCacheKey, JSON.stringify(filtered)); } catch { /* noop */ }
            try { localStorage.setItem(capabilityRefreshTsKey, String(Date.now())); } catch { /* noop */ }
          }
          if (filtered.length > 0) setAccountType(filtered[0] as AccountType);
        }
      } catch {
        // Keep cached capabilities on transient network failures.
      } finally {
        setCapabilityLoading(false);
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
    setSubmitting(true);
    try {
      let res;
      if (accountType === 'us') {
        if (!accountNumber.trim() || !routingNumber.trim()) {
          toast.error('Account number and routing number are required.'); setSubmitting(false); return;
        }
        if (!street.trim() || !city.trim() || !postal.trim() || !country.trim()) {
          toast.error('A full billing address is required for US accounts.'); setSubmitting(false); return;
        }
        res = await backendAPI.bridge.externalAccount.create({
          account_type: 'us',
          account_owner_name: ownerName.trim(),
          account_number: accountNumber.trim(),
          routing_number: routingNumber.trim(),
          ...(bankName.trim() ? { bank_name: bankName.trim() } : {}),
          address: {
            street_line_1: street.trim(),
            city: city.trim(),
            ...(stateRegion.trim() ? { state: stateRegion.trim() } : {}),
            postal_code: postal.trim(),
            country: country.trim().toUpperCase(),
          },
        });
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
        res = await backendAPI.bridge.externalAccount.create({
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
        });
      } else if (accountType === 'clabe') {
        if (!clabeNumber.trim()) {
          toast.error('CLABE account number is required.'); setSubmitting(false); return;
        }
        if (ownerType === 'individual' && (!firstName.trim() || !lastName.trim())) {
          toast.error('First and last name are required.'); setSubmitting(false); return;
        }
        if (ownerType === 'business' && !businessName.trim()) {
          toast.error('Business name is required.'); setSubmitting(false); return;
        }
        if (!street.trim() || !city.trim() || !stateRegion.trim() || !postal.trim() || !country.trim()) {
          toast.error('A full billing address is required for CLABE accounts.'); setSubmitting(false); return;
        }
        res = await backendAPI.bridge.externalAccount.create({
          account_type: 'clabe',
          account_owner_name: ownerName.trim(),
          clabe_number: clabeNumber.trim().replace(/\s+/g, ''),
          ...(bankName.trim() ? { bank_name: bankName.trim() } : {}),
          ...(accountName.trim() ? { account_name: accountName.trim() } : {}),
          ...(ownerType ? { account_owner_type: ownerType } : {}),
          ...(ownerType === 'individual'
            ? { first_name: firstName.trim(), last_name: lastName.trim() }
            : { business_name: businessName.trim() }),
          address: {
            street_line_1: street.trim(),
            city: city.trim(),
            state: stateRegion.trim(),
            postal_code: postal.trim(),
            country: country.trim().toUpperCase(),
          },
        });
      } else {
        if (!documentNumber.trim()) {
          toast.error('Document number is required for Pix accounts.'); setSubmitting(false); return;
        }
        if (pixMode === 'pix_key' && !pixKey.trim()) {
          toast.error('Pix key is required.'); setSubmitting(false); return;
        }
        if (pixMode === 'br_code' && !brCode.trim()) {
          toast.error('BR code is required.'); setSubmitting(false); return;
        }
        res = await backendAPI.bridge.externalAccount.create({
          account_type: 'pix',
          account_owner_name: ownerName.trim(),
          ...(bankName.trim() ? { bank_name: bankName.trim() } : {}),
          document_number: documentNumber.trim(),
          ...(pixMode === 'pix_key'
            ? { pix_key: pixKey.trim() }
            : { br_code: brCode.trim() }),
        });
      }

      if (res?.success) {
        toast.success('Payout account added.');
        onAdded?.();
        onBack();
      } else {
        toast.error((res as any)?.error || 'Could not add the payout account.');
      }
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
  const canUseClabe = supportedAccountTypes.includes('clabe');
  const canUsePix = supportedAccountTypes.includes('pix');
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
        {capabilityLoading ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <SkeletonRows count={3} />
          </div>
        ) : (
          <>
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
            <button type="button" onClick={() => setAccountType('clabe')} disabled={!canUseClabe}
              className={`py-3 rounded-xl border text-sm font-semibold ${
                !canUseClabe
                  ? `bg-white/[0.02] ${tc.textMuted} border-white/10 opacity-50 cursor-not-allowed`
                  : accountType === 'clabe'
                    ? 'bg-[#C7FF00] text-black border-[#C7FF00]'
                    : `bg-white/[0.04] ${tc.text} border-white/10`
              }`}>
              CLABE (MXN)
            </button>
            <button type="button" onClick={() => setAccountType('pix')} disabled={!canUsePix}
              className={`py-3 rounded-xl border text-sm font-semibold ${
                !canUsePix
                  ? `bg-white/[0.02] ${tc.textMuted} border-white/10 opacity-50 cursor-not-allowed`
                  : accountType === 'pix'
                    ? 'bg-[#C7FF00] text-black border-[#C7FF00]'
                    : `bg-white/[0.04] ${tc.text} border-white/10`
              }`}>
              Pix (BRL)
            </button>
          </div>
          <p className={`text-[11px] ${tc.textMuted} mt-1.5`}>
            {accountType === 'us'
              ? 'Supports ACH, ACH same-day, and Wire payouts.'
              : accountType === 'iban'
                ? 'Supports SEPA payouts.'
                : accountType === 'clabe'
                  ? 'Supports SPEI payouts.'
                  : 'Supports Pix payouts.'}
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
        ) : accountType === 'clabe' ? (
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
              <label className={label}>CLABE number</label>
              <input className={field} value={clabeNumber} onChange={e => setClabeNumber(e.target.value)} inputMode="numeric" />
            </div>
            <div>
              <label className={label}>Account name (optional)</label>
              <input className={field} value={accountName} onChange={e => setAccountName(e.target.value)} />
            </div>
            <div>
              <label className={label}>Billing address</label>
              <input className={`${field} mb-2`} value={street} onChange={e => setStreet(e.target.value)} placeholder="Street address" />
              <div className="grid grid-cols-2 gap-2">
                <input className={field} value={city} onChange={e => setCity(e.target.value)} placeholder="City" />
                <input className={field} value={stateRegion} onChange={e => setStateRegion(e.target.value)} placeholder="State" />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <input className={field} value={postal} onChange={e => setPostal(e.target.value)} placeholder="Postal code" />
                <input className={field} value={country} onChange={e => setCountry(e.target.value)} placeholder="Country (ISO-3)" maxLength={3} />
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={label}>Pix mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setPixMode('pix_key')}
                  className={`py-2.5 rounded-xl border text-sm font-semibold ${pixMode === 'pix_key' ? 'bg-[#C7FF00] text-black border-[#C7FF00]' : `bg-white/[0.04] ${tc.text} border-white/10`}`}>
                  Pix key
                </button>
                <button type="button" onClick={() => setPixMode('br_code')}
                  className={`py-2.5 rounded-xl border text-sm font-semibold ${pixMode === 'br_code' ? 'bg-[#C7FF00] text-black border-[#C7FF00]' : `bg-white/[0.04] ${tc.text} border-white/10`}`}>
                  BR code
                </button>
              </div>
            </div>
            {pixMode === 'pix_key' ? (
              <div>
                <label className={label}>Pix key</label>
                <input className={field} value={pixKey} onChange={e => setPixKey(e.target.value)} />
              </div>
            ) : (
              <div>
                <label className={label}>BR code</label>
                <textarea className={`${field} min-h-[88px]`} value={brCode} onChange={e => setBrCode(e.target.value)} />
              </div>
            )}
            <div>
              <label className={label}>Document number</label>
              <input className={field} value={documentNumber} onChange={e => setDocumentNumber(e.target.value)} />
            </div>
          </>
        )}

        <button
          onClick={submit}
          disabled={submitting || !canUseExternalAccounts}
          className="w-full py-3.5 rounded-2xl bg-[#C7FF00] text-black font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 mt-2"
        >
          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Add payout account'}
        </button>
        <button onClick={onBack} className={`w-full py-2.5 text-xs ${tc.textMuted}`}>Cancel</button>
          </>
        )}
      </main>
    </div>
  );
}

export default AddExternalAccountScreen;
