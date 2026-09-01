import { assertEquals } from "jsr:@std/assert";
import { buildScaSignals, type ScaAuditRow } from "../supabase/functions/_shared/sca-monitoring.ts";

const row = (event_type: string, user_id = "user-1"): ScaAuditRow => ({
  user_id,
  event_type,
  reason: null,
  created_at: "2026-09-01T08:00:00Z",
});
Deno.test("SCA monitoring alerts on failed authentication, lockout, replay, scope, and recovery", () => {
  const signals = buildScaSignals([
    ...Array.from({ length: 5 }, () => row("authorization_failed")),
    row("authorization_locked"),
    row("authorization_rejected"), row("authorization_rejected"), row("authorization_rejected"),
    row("scope_unavailable"),
    row("recovery_restricted"),
  ]);
  assertEquals(signals.map((signal) => signal.signalType).sort(), [
    "authentication_lockout",
    "authorization_replay_or_mismatch",
    "failed_authentication_pattern",
    "provider_scope_unavailable",
    "recovery_restriction",
  ]);
});

Deno.test("SCA monitoring does not alert below failure and mismatch thresholds", () => {
  const signals = buildScaSignals([
    ...Array.from({ length: 4 }, () => row("authorization_failed")),
    row("authorization_rejected"), row("authorization_rejected"),
  ]);
  assertEquals(signals, []);
});
