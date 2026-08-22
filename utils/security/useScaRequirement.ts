import { useEffect, useState } from 'react';
import { backendAPI } from '../api/backendAPI';

export type ScaRequirementState = 'checking' | 'required' | 'not_required';

export function useScaRequirement(enabled = true): ScaRequirementState {
  const [state, setState] = useState<ScaRequirementState>(enabled ? 'checking' : 'not_required');

  useEffect(() => {
    if (!enabled) {
      setState('not_required');
      return;
    }
    let active = true;
    setState('checking');
    void backendAPI.auth.getSCARequirement().then((result: any) => {
      if (!active) return;
      // A failed or malformed residency lookup must never suppress SCA.
      setState(result?.success && result?.data?.sca_required === false ? 'not_required' : 'required');
    }).catch(() => {
      if (active) setState('required');
    });
    return () => { active = false; };
  }, [enabled]);

  return state;
}
