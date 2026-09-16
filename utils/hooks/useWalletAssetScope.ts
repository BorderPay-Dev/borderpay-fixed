import { useEffect, useState } from 'react';
import { walletAPI, getCachedWalletAssetScope } from '../api/backendAPI';

/** Unknown is neither EEA nor non-EEA; never flash a region-specific asset. */
export function useWalletAssetScope(userId: string) {
  const [state, setState] = useState(() => ({ userId, scope: getCachedWalletAssetScope(userId), resolved: false }));
  useEffect(() => {
    let active = true;
    const cached = getCachedWalletAssetScope(userId);
    setState({ userId, scope: cached, resolved: Boolean(cached) });
    void walletAPI.getAssetScope(userId).then(scope => {
      if (active) setState({ userId, scope, resolved: true });
    }).catch(() => { if (active) setState({ userId, scope: cached, resolved: true }); });
    return () => { active = false; };
  }, [userId]);
  const scope = state.userId === userId ? state.scope : null;
  return { allowUsdtTron: scope?.allow_usdt_tron === true,
    allowEurcBase: scope?.allow_eurc_base === true,
    resolved: state.userId === userId && state.resolved,
    country: scope?.country ?? null };
}
