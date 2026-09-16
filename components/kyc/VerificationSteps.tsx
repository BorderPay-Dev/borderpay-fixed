import React from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';

interface Props {
  termsAccepted: boolean;
  checkingTerms: boolean;
  opening: boolean;
  onAcceptTerms: () => void;
  onContinue: () => void;
  textClass: string;
  mutedClass: string;
}

export function VerificationSteps({ termsAccepted, checkingTerms, opening, onAcceptTerms, onContinue, textClass, mutedClass }: Props) {
  const busy = checkingTerms || opening;
  return (
    <div className="mt-6 space-y-4">
      <p id="verification-steps-help" className={`text-sm leading-relaxed ${mutedClass}`} aria-live="polite">
        {checkingTerms
          ? 'Checking Terms of Service acceptance…'
          : termsAccepted
            ? 'Terms of Service accepted. Continue verification to complete your details.'
            : 'First accept the Terms of Service. Then return here and tap Continue verification.'}
      </p>
      <div className="space-y-2">
        <p className={`text-xs font-semibold ${textClass}`}>Step 1 · Terms of Service</p>
        {termsAccepted ? (
          <div className={`flex items-center gap-2 py-2 text-sm font-semibold ${textClass}`} role="status">
            <CheckCircle2 className="h-4 w-4" /> Terms accepted
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onAcceptTerms}
            aria-describedby="verification-steps-help"
            className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-full bg-[#C7FF00] text-black font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-95 transition"
          >
            {opening ? 'Opening Terms of Service…' : 'Accept Terms of Service'} <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="space-y-2">
        <p className={`text-xs font-semibold ${textClass}`}>Step 2 · Verification</p>
        <button
          type="button"
          disabled={!termsAccepted || busy}
          onClick={onContinue}
          aria-describedby="verification-steps-help"
          className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-full bg-[#C7FF00] text-black font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-95 transition"
        >
          {opening && termsAccepted ? 'Opening verification…' : 'Continue verification'} <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
