import React, { useEffect, useState } from 'react';
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react';

type LaunchState =
  | { kind: 'loading' }
  | { kind: 'ready'; targetUrl: string }
  | { kind: 'error'; message: string };

const SUPABASE_URL = String(
  import.meta.env.VITE_SUPABASE_URL || 'https://orwrcpwsffjlvzuraxjc.supabase.co',
).replace(/\/+$/, '');

export function VerificationContinuePage() {
  const [state, setState] = useState<LaunchState>({ kind: 'loading' });

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token')?.trim() || '';
    if (!/^[0-9a-f-]{36}$/i.test(token)) {
      setState({ kind: 'error', message: 'This verification link is invalid. Return to BorderPay and try again.' });
      return;
    }

    const controller = new AbortController();
    void fetch(`${SUPABASE_URL}/functions/v1/verification-launch?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).then(async (response) => {
      const payload = await response.json().catch(() => null);
      const targetUrl = String(payload?.data?.target_url || '');
      if (!response.ok || payload?.success !== true || !targetUrl) {
        throw new Error(String(payload?.error || 'Could not open secure verification.'));
      }
      const target = new URL(targetUrl);
      const host = target.hostname.toLowerCase();
      if (target.protocol !== 'https:' || (host !== 'bridge.withpersona.com' && !host.endsWith('.withpersona.com'))) {
        throw new Error('The verification destination is not permitted.');
      }
      setState({ kind: 'ready', targetUrl: target.toString() });
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not open secure verification.',
      });
    });
    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-[100dvh] bg-[#0B0E11] px-5 py-[max(24px,env(safe-area-inset-top))] text-white grid place-items-center">
      <section className="w-full max-w-[420px] rounded-3xl border border-white/10 bg-[#15191E] p-7 text-center shadow-2xl shadow-black/40">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#C7FF00]/10 text-[#C7FF00]">
          <ShieldCheck className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-xl font-semibold">Secure business verification</h1>

        {state.kind === 'loading' && (
          <div role="status" className="mt-5 flex items-center justify-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Preparing your secure verification…
          </div>
        )}

        {state.kind === 'ready' && (
          <>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Continue in the secure verification form. Return to BorderPay when finished.
            </p>
            <a
              href={state.targetUrl}
              className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#C7FF00] px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-[#B7EE00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C7FF00] focus-visible:ring-offset-2 focus-visible:ring-offset-[#15191E]"
            >
              Continue verification
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <p role="alert" className="mt-4 text-sm leading-6 text-red-200">{state.message}</p>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Return to BorderPay and tap Continue verification to generate a fresh link.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
