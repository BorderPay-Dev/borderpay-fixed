import { yellowCardProviderBounds } from '../utils/yellowCardProviderLimits.ts';

function assertEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

Deno.test('Uganda transaction limits come from the Yellow Card channel snapshot, not PDF fee floors', () => {
  for (const direction of ['receive', 'payout'] as const) {
    for (const channel of ['bank', 'mobile_money'] as const) {
      const bounds = yellowCardProviderBounds('UG', 'UGX', channel, direction);
      assertEqual(bounds?.minimum, 15000);
      assertEqual(bounds?.maximum, null);
      assertEqual(bounds?.source, 'yellow_card_api_snapshot_2026-08-12');
    }
  }
});

Deno.test('manual limits are route-specific', () => {
  assertEqual(yellowCardProviderBounds('KE', 'KES', 'mobile_money', 'payout')?.minimum, 150);
  assertEqual(yellowCardProviderBounds('KE', 'KES', 'bank', 'payout')?.minimum, 500);
  assertEqual(yellowCardProviderBounds('ZA', 'ZAR', 'bank', 'receive')?.minimum, 100);
  assertEqual(yellowCardProviderBounds('ZA', 'ZAR', 'bank', 'payout')?.minimum, 200);
  assertEqual(yellowCardProviderBounds('XX', 'USD', 'bank', 'receive'), null);
});
