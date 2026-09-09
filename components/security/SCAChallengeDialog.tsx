import React, { useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { friendlyError } from '../../utils/errors/friendlyError';

type Props = {
  open: boolean;
  title: string;
  description: string;
  operation: 'wallet_access' | 'payment' | 'beneficiary_change' | 'security_change';
  resource: string;
  request: Record<string, unknown>;
  onCancel: () => void;
  onAuthorized: (authorizationId: string) => void | Promise<void>;
};

export function SCAChallengeDialog(props: Props) {
  const [pin, setPin] = useState('');
  const [totp, setTotp] = useState('');
  const [step, setStep] = useState<'knowledge' | 'possession'>('knowledge');
  const [loading, setLoading] = useState(false);
  if (!props.open) return null;

  const submit = async () => {
    if (!/^\d{6}$/.test(pin) || !/^\d{6}$/.test(totp)) {
      toast.error('Enter your 6-digit transaction PIN and authenticator code.');
      return;
    }
    setLoading(true);
    try {
      const result: any = await backendAPI.auth.authorizeSCA({
        operation: props.operation,
        resource: props.resource,
        request: props.request,
        pin,
        totp,
      });
      if (!result?.success || !result?.data?.authorization_id) {
        toast.error(friendlyError(result?.error, 'Strong authentication failed.'));
        return;
      }
      setPin('');
      setTotp('');
      setStep('knowledge');
      await props.onAuthorized(String(result.data.authorization_id));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-5" role="dialog" aria-modal="true" aria-labelledby="sca-title">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#101416] p-5 text-white shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <span className="rounded-2xl bg-[#C7FF00]/10 p-3"><ShieldCheck className="text-[#C7FF00]" size={22} /></span>
            <div><h2 id="sca-title" className="font-bold">{props.title}</h2><p className="mt-1 text-xs text-gray-400">{props.description}</p></div>
          </div>
          <button type="button" onClick={props.onCancel} aria-label="Cancel"><X size={20} /></button>
        </div>
        <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500" aria-label={`Strong authentication step ${step === 'knowledge' ? '1' : '2'} of 2`}>
          <span className={step === 'knowledge' ? 'text-[#C7FF00]' : 'text-white'}>1. Transaction PIN</span>
          <span aria-hidden="true">→</span>
          <span className={step === 'possession' ? 'text-[#C7FF00]' : ''}>2. Authenticator</span>
        </div>
        {step === 'knowledge' ? (
          <>
            <label className="mb-1 block text-xs text-gray-400" htmlFor="sca-pin">Transaction PIN</label>
            <input id="sca-pin" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="off" autoFocus className="mb-5 w-full rounded-xl border border-white/10 bg-black px-4 py-3" />
            <button type="button" onClick={() => /^\d{6}$/.test(pin) ? setStep('possession') : toast.error('Enter your 6-digit transaction PIN.')} className="w-full rounded-xl bg-[#C7FF00] px-4 py-3 font-bold text-black">Continue</button>
          </>
        ) : (
          <>
            <label className="mb-1 block text-xs text-gray-400" htmlFor="sca-totp">Authenticator code</label>
            <input id="sca-totp" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus className="mb-5 w-full rounded-xl border border-white/10 bg-black px-4 py-3 tracking-[0.3em]" />
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <button type="button" onClick={() => { setTotp(''); setStep('knowledge'); }} disabled={loading} className="rounded-xl border border-white/10 px-4 py-3 font-semibold text-white disabled:opacity-50">Back</button>
              <button type="button" onClick={() => void submit()} disabled={loading} className="rounded-xl bg-[#C7FF00] px-4 py-3 font-bold text-black disabled:opacity-50">{loading ? 'Verifying…' : 'Verify action'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
