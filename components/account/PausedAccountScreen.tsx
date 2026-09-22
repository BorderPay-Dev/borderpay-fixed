import React from 'react';
import { LockKeyhole } from 'lucide-react';
import { formatBridgePausedDate } from '../../utils/bridgeAccountStatus';

const PAUSED_ACCOUNT_REASON =
  'This account exceeds our present risk tolerance, as determined by a combination of local regulatory requirements, commercial partnerships, and other pertinent factors. If we are able to unfreeze this account and need more information, our team will reach out separately.';

interface PausedAccountScreenProps { pausedAt?: string | null; reason?: string | null; locallyFrozen?: boolean; onSignOut: () => void; }

export function PausedAccountScreen({ pausedAt, reason, locallyFrozen = false, onSignOut }: PausedAccountScreenProps) {
  const pausedDate = formatBridgePausedDate(pausedAt);

  return (
    <main className="fixed inset-0 z-[10000] flex min-h-[var(--app-height)] items-center justify-center overflow-y-auto bg-[#080A0D] px-5 py-8 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#11151A] p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/10 ring-1 ring-amber-300/20">
          <LockKeyhole className="h-7 w-7 text-amber-300" aria-hidden="true" />
        </div>

        <div className="mb-4 inline-flex rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">
          Account frozen
        </div>

        <h1 className="text-2xl font-bold tracking-tight">Your account is {locallyFrozen ? 'frozen' : 'paused'}</h1>
        <p className="mt-4 text-sm leading-6 text-white/70">
          {pausedDate ? `This customer was ${locallyFrozen ? 'frozen' : 'paused'} on ${pausedDate} due to: ` : `This customer was ${locallyFrozen ? 'frozen' : 'paused'} due to: `}
          {reason || PAUSED_ACCOUNT_REASON}
        </p>

        <p className="mt-5 text-xs leading-5 text-white/45">
          You do not need to submit another verification request. BorderPay will contact you if anything is required.
        </p>

        <button
          type="button"
          onClick={onSignOut}
          className="mt-7 h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] text-sm font-semibold text-white transition-colors hover:bg-white/10 active:scale-[0.99]"
        >
          Sign out
        </button>
      </section>
    </main>
  );
}
