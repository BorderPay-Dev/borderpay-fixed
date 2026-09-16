import { useEffect, useState } from 'react';
import { walletAPI, getCachedWalletAssetScope } from '../api/backendAPI';

/** Unknown is neither EEA nor non-EEA; never flash a region-specific asset. */
export function useWalletAssetScope(userId: string, refreshKey?: unknown) {
  const [state, setState] = useState(() => ({ userId, scope: getCachedWalletAssetScope(userId, 5 * 60_000), resolved: false }));
  useEffect(() => {
    let active = true;
    const cached = getCachedWalletAssetScope(userId, 5 * 60_000);
    setState({ userId, scope: cached, resolved: Boolean(cached) });
    void walletAPI.getAssetScope(userId).then(scope => {
      // A failed refresh does not mean a previously verified region changed.
      // Keep the short-lived display cache; server checks still govern actions.
      if (active) setState({ userId, scope: scope.country ? scope : cached, resolved: Boolean(scope.country) });
    }).catch(() => { if (active) setState({ userId, scope: cached, resolved: true }); });
    return () => { active = false; };
  }, [userId, refreshKey]);
  const scope = state.userId === userId ? state.scope : null;
  return { allowUsdtTron: scope?.allow_usdt_tron === true,
    allowEurcBase: scope?.allow_eurc_base === true,
    resolved: state.userId === userId && state.resolved,
    country: scope?.country ?? null };
}
