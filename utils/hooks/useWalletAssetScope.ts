import { useEffect, useState } from 'react';
import { backendAPI } from '../api/backendAPI';

/** Provider-backed regional wallet boundary. Unknown scope stays EEA-safe. */
export function useWalletAssetScope(userId: string) {
  const [allowUsdtTron, setAllowUsdtTron] = useState(false);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let active = true;
    setAllowUsdtTron(false);
    setResolved(false);
    void backendAPI.sca.scope().then((response: any) => {
      if (!active) return;
      const data = response?.data;
      setAllowUsdtTron(Boolean(
        response?.success
        && data?.reason === 'non_eea'
        && String(data?.country || '').trim(),
      ));
      setResolved(true);
    }).catch(() => {
      if (active) setResolved(true);
    });
    return () => { active = false; };
  }, [userId]);

  return { allowUsdtTron, resolved };
}
