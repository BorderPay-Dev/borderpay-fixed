import {
  extractReferralCodeFromUrl,
  normalizeReferralCode,
} from '../utils/affiliate/referralAttribution.ts';

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

Deno.test('affiliate code is captured from canonical signup links', () => {
  assertEquals(
    extractReferralCodeFromUrl('https://app.borderpayafrica.com/signup?ref=bp12abef'),
    'BP12ABEF',
  );
});

Deno.test('legacy root and hash referral links remain compatible', () => {
  assertEquals(extractReferralCodeFromUrl('https://app.borderpayafrica.com/?ref=BPABC123'), 'BPABC123');
  assertEquals(extractReferralCodeFromUrl('https://app.borderpayafrica.com/#ref=BPABC123'), 'BPABC123');
});

Deno.test('malformed referral codes are rejected', () => {
  assertEquals(normalizeReferralCode('BP123'), null);
  assertEquals(extractReferralCodeFromUrl('https://app.borderpayafrica.com/signup?ref=<script>'), null);
});
