import {
  SendCapabilityTimeoutError,
  withSendCapabilityTimeout,
} from '../components/send/sendCapabilityTimeout.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('Send capability discovery rejects a never-resolving request at its bounded timeout', async () => {
  const neverResolving = new Promise<never>(() => {});
  const startedAt = Date.now();
  let failure: unknown = null;

  try {
    await withSendCapabilityTimeout(neverResolving, 25);
  } catch (error) {
    failure = error;
  }

  assert(failure instanceof SendCapabilityTimeoutError, 'expected SendCapabilityTimeoutError');
  assert(Date.now() - startedAt < 1_000, 'never-resolving capability request did not stop promptly');
});

Deno.test('Send capability discovery preserves a successful result before timeout', async () => {
  const result = await withSendCapabilityTimeout(Promise.resolve({ success: true }), 100);
  assert(result.success === true, 'successful capability result must pass through unchanged');
});
