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
      // SCA is scoped only to users the authenticated server positively
      // classifies as verified EEA customers. A lookup failure must not turn
      // the entire global customer base into EEA users.
      setState(result?.success && result?.data?.sca_required === true ? 'required' : 'not_required');
    }).catch(() => {
      if (active) setState('not_required');
    });
    return () => { active = false; };
  }, [enabled]);

  return state;
}
