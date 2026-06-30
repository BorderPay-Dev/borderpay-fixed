export type FlutterwaveTransferLifecycle =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "unknown";

export function normalizeFlutterwaveTransferState(raw: unknown): FlutterwaveTransferLifecycle {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (["successful", "success", "completed", "complete", "paid", "delivered"].includes(s)) return "completed";
  if (["failed", "error", "cancelled", "canceled", "reversed", "declined"].includes(s)) return "failed";
  if (["pending", "queued", "initiated", "created"].includes(s)) return "pending";
  if (["processing", "in_progress", "in-progress", "under_review", "under-review"].includes(s)) return "processing";
  return "unknown";
}

