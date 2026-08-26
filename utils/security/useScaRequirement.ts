import { useEffect, useState } from 'react';
import { backendAPI } from '../api/backendAPI';

export type ScaRequirementState = 'checking' | 'required' | 'not_required' | 'unavailable';

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
      if (!result?.success) {
        setState('unavailable');
        return;
      }
      setState(result?.data?.sca_required === true ? 'required' : 'not_required');
    }).catch(() => {
      // Failure to establish provider-authoritative scope must not expose
      // financial information as though Bridge had confirmed non-EEA status.
      if (active) setState('unavailable');
    });
    return () => { active = false; };
  }, [enabled]);

  return state;
}
