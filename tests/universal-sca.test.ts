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

Deno.test('Bridge SCA attestation uses the corrected nested-outcome contract', () => {
  const web = bridgeScaInitiation('other');
  assert(web.channel === 'other', 'web channel must be other');
  assert(web.subchannel === 'remote', 'Bridge digital transfers must be remote');
  assert(web.attestations.sca.outcome === 'sca_used', 'SCA outcome must use Bridge\'s corrected nested shape');
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

Deno.test('current Bridge-derived EEA scope is authoritative', async () => {
  const db = {
    from(table: string) {
      assert(table === 'sca_customer_scopes', 'consumer must read only the provider scope cache');
      const result = { data: { provider_country: 'FR', sca_required: true, source: 'bridge_customer_api', expires_at: '2099-01-01T00:00:00Z' }, error: null };
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        gt: () => chain,
        maybeSingle: () => Promise.resolve(result),
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  const result = await resolveScaResidencyRequirement(db, 'user-1');
  assert(result.required && result.country === 'FR', 'current Bridge-derived scope must control residency');
});

Deno.test('provider scope lookup errors remain unknown rather than guessed EEA', async () => {
  const db = {
    from() {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        gt: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: { code: 'lookup_failed' } }),
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  const result = await resolveScaResidencyRequirement(db, 'user-1');
  assert(!result.required && result.reason === 'residency_unknown', 'lookup errors must not classify a user as verified EEA');
});

Deno.test('current Bridge-derived non-EEA scope bypasses SCA', async () => {
  const db = {
    from(table: string) {
      assert(table === 'sca_customer_scopes', 'consumer must read only the provider scope cache');
      const result = { data: { provider_country: 'KE', sca_required: false, source: 'bridge_customer_api', expires_at: '2099-01-01T00:00:00Z' }, error: null };
      const chain: any = { select: () => chain, eq: () => chain, gt: () => chain, maybeSingle: () => Promise.resolve(result) };
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  const result = await resolveScaResidencyRequirement(db, 'user-1');
  assert(!result.required && result.reason === 'non_eea_resident', 'Bridge-derived non-EEA users must bypass SCA');
});
