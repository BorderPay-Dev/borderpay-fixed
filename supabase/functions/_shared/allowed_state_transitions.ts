export type LifecycleTable = "pending_events" | "bridge_webhook_events" | "bridge_transfers";

type TransitionSet = Readonly<Record<string, ReadonlySet<string>>>;

export const ALLOWED_STATE_TRANSITIONS: Readonly<Record<LifecycleTable, TransitionSet>> = {
  pending_events: {
    queued: new Set(["processing", "failed"]),
    processing: new Set(["completed", "failed", "queued"]),
    failed: new Set(["queued"]),
    completed: new Set([]),
  },
  bridge_webhook_events: {
    received: new Set(["queued", "rejected"]),
    queued: new Set(["completed", "failed"]),
    failed: new Set(["queued"]),
    completed: new Set([]),
    rejected: new Set([]),
  },
  bridge_transfers: {
    pending: new Set(["succeeded", "failed", "cancelled", "returned", "refunded"]),
    succeeded: new Set([]),
    failed: new Set([]),
    cancelled: new Set([]),
    returned: new Set([]),
    refunded: new Set([]),
  },
} as const;

export function canTransition(
  table: LifecycleTable,
  fromState: string | null | undefined,
  toState: string | null | undefined,
): boolean {
  const from = String(fromState ?? "").toLowerCase().trim();
  const to = String(toState ?? "").toLowerCase().trim();
  if (!from || !to) return false;
  if (from === to) return true;
  const tableMap = ALLOWED_STATE_TRANSITIONS[table];
  const next = tableMap[from];
  if (!next) return false;
  return next.has(to);
}

