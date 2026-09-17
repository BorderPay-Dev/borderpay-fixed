/** Dedicated treasury transport. Never retries money movement automatically. */
export async function treasuryRequest<T>(options: {
  url: string; key: string; token: () => Promise<string | null>;
  body: Record<string, unknown>; timeoutMs?: number; fetcher?: typeof fetch;
}): Promise<{ success: boolean; data?: T; error?: string }> {
  const controller = new AbortController();
  const mutation = options.body.action === 'transfer';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const token = await options.token();
        if (controller.signal.aborted) throw new Error('timeout');
        if (!token) return { success: false, error: 'Your session has expired. Sign in again.' };
        const response = await (options.fetcher || fetch)(options.url, {
          method: 'POST', signal: controller.signal,
          headers: { apikey: options.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(options.body),
        });
        const body = await response.json();
        if (!response.ok || body?.success !== true || !body?.data) {
          return { success: false, error: response.status === 401 || response.status === 403
            ? 'Your session or treasury access could not be verified. Sign in again.'
            : typeof body?.error === 'string' ? body.error : 'Treasury could not load the response. Please refresh.' };
        }
        return { success: true, data: body.data as T };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, options.timeoutMs ?? (mutation ? 60_000 : 45_000));
      }),
    ]);
  } catch {
    return { success: false, error: mutation
      ? 'Submission could not be confirmed. Check Activity before trying again. Keep this transfer unchanged to reuse its reference.'
      : 'Treasury refresh could not complete. Your last available data is still shown. Try again.' };
  } finally { clearTimeout(timer); }
}
