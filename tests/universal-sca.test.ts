import {
  classifyScaResidency,
  resolveScaResidencyRequirement,
  scaCanonicalPayload,
  scaPayloadHash,
} from '../supabase/functions/_shared/sca.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('SCA canonical payload is stable and excludes credentials and authorization id', async () => {
  const a = await scaPayloadHash('bridge_transfer', {
    destination: { currency: 'USDC', address: '0xabc' },
    pin: '123456',
    sca_authorization_id: 'ignored',
    source: { amount: '10.00', currency: 'USDC' },
  });
  const b = await scaPayloadHash('bridge_transfer', {
    source: { currency: 'USDC', amount: '10.00' },
    destination: { address: '0xabc', currency: 'USDC' },
    totp: '654321',
  });
  assert(a === b, 'equivalent requests must produce the same hash');
  assert(!scaCanonicalPayload('bridge_transfer', { pin: '123456', totp: '654321' }).includes('123456'), 'PIN must not enter canonical evidence');
});
Deno.test('SCA dynamic link changes when amount, payee, operation resource, or idempotency key changes', async () => {
  const base = { idempotency_key: 'intent-12345678', source: { amount: '10.00' }, destination: { address: 'payee-a' } };
  const original = await scaPayloadHash('bridge_transfer', base);
  assert(original !== await scaPayloadHash('bridge_transfer', { ...base, source: { amount: '10.01' } }), 'amount change must invalidate authorization');
  assert(original !== await scaPayloadHash('bridge_transfer', { ...base, destination: { address: 'payee-b' } }), 'payee change must invalidate authorization');
  assert(original !== await scaPayloadHash('bridge_transfer', { ...base, idempotency_key: 'intent-87654321' }), 'intent change must invalidate authorization');
  assert(original !== await scaPayloadHash('yellowcard_transaction', base), 'resource change must invalidate authorization');
});

Deno.test('SCA residency scope includes the EEA and excludes UK, Switzerland, and Africa', () => {
  for (const country of ['FR', 'DE', 'NO', 'IS', 'LI']) {
    assert(classifyScaResidency(country).required, `${country} must require SCA`);
  }
  for (const country of ['GB', 'CH', 'KE', 'NG', 'ZA']) {
    assert(!classifyScaResidency(country).required, `${country} must not receive the EEA SCA requirement`);
  }
});

Deno.test('missing, malformed, and unknown residency fail closed', () => {
  for (const country of [null, '', 'France', 'ZZ']) {
    const result = classifyScaResidency(country);
    assert(result.required && result.reason === 'residency_unknown', `${String(country)} must fail closed`);
  }
});

Deno.test('business residency is authoritative over the base profile', async () => {
  const db = {
    from(table: string) {
      const result = table === 'user_profiles'
        ? { data: { id: 'user-1', account_type: 'business', country: 'KE' }, error: null }
        : { data: { country: 'FR' }, error: null };
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(result),
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  const result = await resolveScaResidencyRequirement(db, 'user-1');
  assert(result.required && result.country === 'FR', 'business profile country must control business residency');
});

Deno.test('residency lookup errors fail closed', async () => {
  const db = {
    from() {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: { code: 'lookup_failed' } }),
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  const result = await resolveScaResidencyRequirement(db, 'user-1');
  assert(result.required && result.reason === 'residency_unknown', 'lookup errors must retain SCA');
});
