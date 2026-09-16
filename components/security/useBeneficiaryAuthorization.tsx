import React, { useEffect, useRef, useState } from 'react';
import { backendAPI } from '../../utils/api/backendAPI';
import { PINManager } from '../../utils/security/SecurityManager';
import { authAPI } from '../../utils/supabase/client';
import * as Dialog from '@radix-ui/react-dialog';

/** Keep factor values in memory only and bind authorization to the frozen action. */
export function useBeneficiaryAuthorization() {
  const pending = useRef<{ request: Record<string, unknown>; resolve: (id: string | undefined | null) => void; userId: string } | null>(null);
  const pin = useRef('');
  const [step, setStep] = useState<'pin' | 'totp' | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const finish = (id: string | undefined | null) => {
    const current = pending.current;
    pending.current = null; pin.current = ''; setValue(''); setStep(null); setError('');
    current?.resolve(id);
  };
  useEffect(() => () => { pending.current?.resolve(null); pending.current = null; pin.current = ''; }, []);
  const authorize = async (request: Record<string, unknown>): Promise<string | undefined | null> => {
    if (pending.current) return null;
    const status: any = await backendAPI.sca.status();
    if (!status.success) throw new Error(status.error || 'Strong authentication is unavailable.');
    if (!status.data?.required) return undefined;
    return new Promise(resolve => {
      pending.current = { request: structuredClone(request), resolve, userId: String(authAPI.getStoredUser()?.id || '') };
      setValue(''); setError(''); setStep('pin');
    });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pending.current || !/^\d{6}$/.test(value) || inFlight.current) return;
    const current = pending.current;
    if (authAPI.getStoredUser()?.id !== current.userId) { finish(null); return; }
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (step === 'pin') {
        const result = await PINManager.verifyTransactionPIN(current.userId, value);
        if (!result.success) throw new Error(result.error || 'Incorrect transaction PIN.');
        if (pending.current !== current) return;
        pin.current = value; setValue(''); setStep('totp');
      } else {
        const result: any = await backendAPI.sca.authorizeBeneficiary({ pin: pin.current, totp: value, request: current.request });
        if (!result.success || !result.data?.authorization_id) throw new Error(result.error || 'Could not authorize this change.');
        if (pending.current === current) finish(result.data.authorization_id);
      }
    } catch (reason) {
      if (pending.current === current) { setError(reason instanceof Error ? reason.message : 'Authentication failed.'); setValue(''); }
    } finally { inFlight.current = false; setBusy(false); }
  };
  const dialog = <Dialog.Root open={step !== null} onOpenChange={open => { if (!open) finish(null); }}>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[2147483602] bg-black/70" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[2147483603] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-[#0B0E11] p-6 text-white space-y-4">
      <Dialog.Title className="text-lg font-semibold">{step === 'pin' ? 'Enter transaction PIN' : 'Enter authenticator code'}</Dialog.Title>
      <Dialog.Description className="text-sm text-white/70">Authorize this payout account change. {step === 'pin' ? 'Step 1 of 2.' : 'Step 2 of 2.'}</Dialog.Description>
      <form onSubmit={submit} className="space-y-4">
        <input key={step} aria-label={step === 'pin' ? 'Transaction PIN' : 'Authenticator code'} autoFocus type={step === 'pin' ? 'password' : 'text'} inputMode="numeric" autoComplete={step === 'pin' ? 'off' : 'one-time-code'} maxLength={6} value={value} disabled={busy} onChange={e => setValue(e.target.value.replace(/\D/g, ''))} className="w-full rounded-xl border border-white/20 bg-transparent px-4 py-3" />
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={busy || value.length !== 6} className="w-full rounded-xl bg-[#C7FF00] px-4 py-3 font-semibold text-black disabled:opacity-50">{busy ? 'Verifying…' : 'Continue'}</button>
      </form>
      <Dialog.Close className="w-full rounded-xl border border-white/20 py-3">Cancel</Dialog.Close>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
  return { authorize, dialog };
}
