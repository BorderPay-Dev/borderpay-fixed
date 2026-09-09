export type ScaAuditRow = {
  user_id: string | null;
  event_type: string;
  reason: string | null;
  created_at: string;
};

export type ScaSignal = {
  signalType: "failed_authentication_pattern" | "authentication_lockout" |
    "authorization_replay_or_mismatch" | "provider_scope_unavailable" | "recovery_restriction";
  severity: "medium" | "high" | "critical";
  userId: string | null;
  count: number;
};

export function buildScaSignals(rows: ScaAuditRow[]): ScaSignal[] {
  const byUser = new Map<string, ScaAuditRow[]>();
  for (const row of rows) {
    const key = row.user_id || "unknown";
    byUser.set(key, [...(byUser.get(key) || []), row]);
  }

  const signals: ScaSignal[] = [];
  for (const [userKey, userRows] of byUser) {
    const userId = userKey === "unknown" ? null : userKey;
    const failed = userRows.filter((row) => row.event_type === "authorization_failed").length;
    const locked = userRows.filter((row) => row.event_type === "authorization_locked").length;
    const rejected = userRows.filter((row) => row.event_type === "authorization_rejected").length;
    const unavailable = userRows.filter((row) => row.event_type === "scope_unavailable").length;
    const recovery = userRows.filter((row) => row.event_type === "recovery_restricted").length;
    if (failed >= 5) signals.push({ signalType: "failed_authentication_pattern", severity: "high", userId, count: failed });
    if (locked > 0) signals.push({ signalType: "authentication_lockout", severity: "critical", userId, count: locked });
    if (rejected >= 3) signals.push({ signalType: "authorization_replay_or_mismatch", severity: "critical", userId, count: rejected });
    if (unavailable > 0) signals.push({ signalType: "provider_scope_unavailable", severity: "high", userId, count: unavailable });
    if (recovery > 0) signals.push({ signalType: "recovery_restriction", severity: "medium", userId, count: recovery });
  }
  return signals;
}
