/**
 * AddExternalAccountScreen — add a fiat payout (offramp) destination.
 *
 * v1 supports two Bridge external-account types:
 *   • US bank account (USD) — ACH / ACH same-day / Wire all settle here;
 *     the rail is chosen later at transfer time.
 *   • IBAN (EUR) — SEPA.
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

import React, { useState } from 'react';
import { ArrowLeft, Banknote, Loader2, Building2, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

type AccountType = 'us' | 'iban';

interface AddExternalAccountScreenProps {
  onBack: () => void;
  onAdded?: () => void;
}

export function AddExternalAccountScreen({ onBack, onAdded }: AddExternalAccountScreenProps) {
  const tc = useThemeClasses();
  const [accountType, setAccountType] = useState<AccountType>('us');
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
      } else {
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
      }

      if (res?.success) {
        toast.success('Payout account added.');
        onAdded?.();
        onBack();
      } else {
        toast.error((res as any)?.error || 'Could not add the payout account.');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not add the payout account.');
    } finally {
      setSubmitting(false);
    }
  };

  const field = `w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm ${tc.text} focus:outline-none focus:border-[#C7FF00]/40`;
  const label = `block text-xs ${tc.textMuted} uppercase tracking-[0.12em] font-semibold mb-1.5`;

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <header className="flex items-center gap-3 px-5 sm:px-6 pt-5 pb-3">
        <button onClick={onBack} className={`w-9 h-9 rounded-full ${tc.card} border ${tc.cardBorder} flex items-center justify-center`} aria-label="Back">
          <ArrowLeft className={`w-4 h-4 ${tc.text}`} />
        </button>
        <h1 className={`text-base font-semibold ${tc.text}`}>Add payout account</h1>
      </header>

      <main className="px-5 sm:px-6 pb-10 max-w-md mx-auto space-y-4">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <Banknote className="w-5 h-5 text-[#C7FF00]" />
          <p className={`text-xs ${tc.textMuted} leading-relaxed`}>
            Add a bank account you own to receive payouts. Verification and payouts are handled by Bridge.
          </p>
        </div>

        {/* Account type */}
        <div>
          <label className={label}>Account type</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setAccountType('us')}
              className={`py-3 rounded-xl border text-sm font-semibold ${accountType === 'us' ? 'bg-[#C7FF00] text-black border-[#C7FF00]' : `bg-white/[0.04] ${tc.text} border-white/10`}`}>
              US bank (USD)
            </button>
            <button type="button" onClick={() => setAccountType('iban')}
              className={`py-3 rounded-xl border text-sm font-semibold ${accountType === 'iban' ? 'bg-[#C7FF00] text-black border-[#C7FF00]' : `bg-white/[0.04] ${tc.text} border-white/10`}`}>
              IBAN (EUR)
            </button>
          </div>
          <p className={`text-[11px] ${tc.textMuted} mt-1.5`}>
            {accountType === 'us'
              ? 'Supports ACH, ACH same-day, and Wire payouts.'
              : 'Supports SEPA payouts.'}
          </p>
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
        ) : (
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
        )}

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full py-3.5 rounded-2xl bg-[#C7FF00] text-black font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 mt-2"
        >
          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Add payout account'}
        </button>
        <button onClick={onBack} className={`w-full py-2.5 text-xs ${tc.textMuted}`}>Cancel</button>
      </main>
    </div>
  );
}

export default AddExternalAccountScreen;
