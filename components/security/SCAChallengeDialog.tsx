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
  request: Record<string, any>;
  onCancel: () => void;
  onAuthorized: (authorizationId: string) => void | Promise<void>;
  onSetupPin?: () => void;
  onSetupTotp?: () => void;
};

export function SCAChallengeDialog(props: Props) {
  const [pin, setPin] = useState('');
  const [totp, setTotp] = useState('');
  const [loading, setLoading] = useState(false);
  if (!props.open) return null;

  const submit = async () => {
    if (!/^\d{4,6}$/.test(pin) || !/^\d{6}$/.test(totp)) {
      toast.error('Enter your transaction PIN and 6-digit authenticator code.');
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
        <label className="mb-1 block text-xs text-gray-400" htmlFor="sca-pin">Transaction PIN</label>
        <input id="sca-pin" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="off" className="mb-4 w-full rounded-xl border border-white/10 bg-black px-4 py-3" />
        <label className="mb-1 block text-xs text-gray-400" htmlFor="sca-totp">Authenticator code</label>
        <input id="sca-totp" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="mb-5 w-full rounded-xl border border-white/10 bg-black px-4 py-3 tracking-[0.3em]" />
        <button type="button" onClick={() => void submit()} disabled={loading} className="w-full rounded-xl bg-[#C7FF00] px-4 py-3 font-bold text-black disabled:opacity-50">
          {loading ? 'Verifying…' : 'Verify action'}
        </button>
        {(props.onSetupPin || props.onSetupTotp) && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {props.onSetupPin && <button type="button" onClick={props.onSetupPin} className="rounded-xl border border-white/10 px-3 py-2 text-xs">Set up PIN</button>}
            {props.onSetupTotp && <button type="button" onClick={props.onSetupTotp} className="rounded-xl border border-white/10 px-3 py-2 text-xs">Set up authenticator</button>}
          </div>
        )}
      </div>
    </div>
  );
}
