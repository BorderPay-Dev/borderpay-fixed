export const SEND_CAPABILITY_DISCOVERY_TIMEOUT_MS = 15_000;

export class SendCapabilityTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Payout rail discovery timed out after ${timeoutMs}ms`);
    this.name = 'SendCapabilityTimeoutError';
  }
}

export async function withSendCapabilityTimeout<T>(
  operation: Promise<T>,
  timeoutMs = SEND_CAPABILITY_DISCOVERY_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new SendCapabilityTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}
