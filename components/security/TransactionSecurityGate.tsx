import React from 'react';
import { ArrowLeft, Fingerprint, KeyRound, ShieldCheck } from 'lucide-react';

interface TransactionSecurityGateProps {
  onBack: () => void;
  onSetupPin: () => void;
  onSetupBiometric: () => void;
}

export function TransactionSecurityGate({ onBack, onSetupPin, onSetupBiometric }: TransactionSecurityGateProps) {
  return (
    <div className="px-5 py-8">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to transaction review"
        className="mb-8 flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-white active:scale-95"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>

      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-[#C7FF00]/10">
          <ShieldCheck className="h-10 w-10 text-[#C7FF00]" />
        </div>
        <h1 className="text-2xl font-bold text-white">Secure your transactions</h1>
        <p className="mt-3 text-sm leading-6 text-white/60">
          Set up a transaction PIN or biometric verification before confirming a transfer.
        </p>

        <div className="mt-8 space-y-3 text-left">
          <button
            type="button"
            onClick={onSetupPin}
            className="flex min-h-16 w-full items-center gap-4 rounded-2xl bg-[#C7FF00] px-5 py-4 text-left text-black transition active:scale-[0.98]"
          >
            <KeyRound className="h-6 w-6 shrink-0" />
            <span>
              <span className="block text-sm font-bold">Set up transaction PIN</span>
              <span className="mt-0.5 block text-xs text-black/60">Create a secure 6-digit PIN</span>
            </span>
          </button>

          <button
            type="button"
            onClick={onSetupBiometric}
            className="flex min-h-16 w-full items-center gap-4 rounded-2xl border border-white/[0.10] bg-white/[0.04] px-5 py-4 text-left text-white transition active:scale-[0.98]"
          >
            <Fingerprint className="h-6 w-6 shrink-0 text-[#C7FF00]" />
            <span>
              <span className="block text-sm font-bold">Enable biometric verification</span>
              <span className="mt-0.5 block text-xs text-white/50">Use Face ID, Touch ID, or device biometrics</span>
            </span>
          </button>
        </div>

        <p className="mt-6 text-xs text-white/40">One option is required for transactions. Two-factor authentication is optional.</p>
      </div>
    </div>
  );
}
