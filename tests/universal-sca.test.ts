import {
  bridgeScaInitiation,
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

Deno.test('Bridge SCA attestation uses the exact enum-string contract', () => {
  const web = bridgeScaInitiation('other');
  assert(web.channel === 'other', 'web channel must be other');
  assert(web.subchannel === 'remote', 'Bridge digital transfers must be remote');
  assert(web.attestations.sca === 'sca_used', 'SCA must be the enum string, not an object');
  const mobile = bridgeScaInitiation('other_mobile_payment');
  assert(mobile.channel === 'other_mobile_payment', 'native channel must be other_mobile_payment');
  let rejected = false;
  try { bridgeScaInitiation('p2p_mobile_payment'); } catch { rejected = true; }
  assert(rejected, 'unsupported initiation channels must fail closed');
});

Deno.test('SCA residency scope includes the EEA and excludes UK, Switzerland, and Africa', () => {
  for (const country of ['FR', 'DE', 'NO', 'IS', 'LI', 'France', 'FRA']) {
    assert(classifyScaResidency(country).required, `${country} must require SCA`);
  }
  for (const country of ['GB', 'CH', 'KE', 'NG', 'ZA']) {
    assert(!classifyScaResidency(country).required, `${country} must not receive the EEA SCA requirement`);
  }
});

Deno.test('the raw classifier never guesses that unknown residency is EEA', () => {
  for (const country of [null, '', 'France', 'ZZ']) {
    const result = classifyScaResidency(country);
    if (country === 'France') assert(result.required, 'France must normalize to EEA');
    else assert(!result.required && result.reason === 'residency_unknown', `${String(country)} must remain outside EEA SCA`);
  }
});

Deno.test('business residency is authoritative over the base profile', async () => {
  const db = {
    from(table: string) {
      const result = table === 'user_profiles'
        ? { data: { id: 'user-1', account_type: 'business', country: 'KE', kyc_status: 'approved', bridge_kyc_status: 'approved' }, error: null }
        : { data: { country: 'FR', bridge_kyb_status: 'approved' }, error: null };
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

Deno.test('legacy profile lookup errors remain unknown rather than guessed EEA', async () => {
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
  assert(!result.required && result.reason === 'residency_unknown', 'lookup errors must not classify a user as verified EEA');
});

Deno.test('SCA is limited to verified EEA users', async () => {
  const db = {
    from(table: string) {
      const result = table === 'user_profiles'
        ? { data: { id: 'user-1', account_type: 'business', country: 'FR', kyc_status: 'approved', bridge_kyc_status: 'approved' }, error: null }
        : { data: { country: 'France', bridge_kyb_status: 'under_review' }, error: null };
      const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve(result) };
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  const result = await resolveScaResidencyRequirement(db, 'user-1');
  assert(!result.required && result.reason === 'verification_not_approved', 'unverified EEA users must not enter the SCA flow');
});
