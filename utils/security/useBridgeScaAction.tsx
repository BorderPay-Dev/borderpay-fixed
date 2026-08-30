import React, { useCallback, useRef, useState } from 'react';
import { backendAPI } from '../api/backendAPI';
import { SCAChallengeDialog } from '../../components/security/SCAChallengeDialog';

type Operation = 'wallet_access' | 'payment' | 'beneficiary_change' | 'security_change';
type PendingChallenge = {
  operation: Operation;
  resource: string;
  request: Record<string, unknown>;
  title: string;
  description: string;
};

/**
 * Requests Bridge SCA only when the server says the authenticated customer is
 * a verified EEA custodial-wallet user. Scope is never inferred client-side.
 */
export function useBridgeScaAction() {
  const [pending, setPending] = useState<PendingChallenge | null>(null);
  const resolver = useRef<((value: string) => void) | null>(null);
  const rejecter = useRef<((reason: Error) => void) | null>(null);

  const authorize = useCallback(async (challenge: PendingChallenge): Promise<string> => {
    const scope: any = await backendAPI.auth.getScaScope();
    if (!scope?.success || !scope?.data) throw new Error('Strong-authentication scope could not be verified. Nothing was changed.');
    if (scope.data.required !== true) return '';
    return await new Promise<string>((resolve, reject) => {
      resolver.current = resolve;
      rejecter.current = reject;
      setPending(challenge);
    });
  }, []);

  const challenge = pending ? (
    <SCAChallengeDialog
      open
      title={pending.title}
      description={pending.description}
      operation={pending.operation}
      resource={pending.resource}
      request={pending.request}
      onCancel={() => {
        setPending(null);
        rejecter.current?.(new Error('Strong authentication cancelled.'));
        resolver.current = null;
        rejecter.current = null;
      }}
      onAuthorized={(authorizationId) => {
        setPending(null);
        resolver.current?.(authorizationId);
        resolver.current = null;
        rejecter.current = null;
      }}
    />
  ) : null;

  return { authorize, challenge };
}
