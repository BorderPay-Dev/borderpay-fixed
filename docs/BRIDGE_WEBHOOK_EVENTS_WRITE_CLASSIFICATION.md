# Bridge Webhook Events Write Classification

- Scope: remaining runtime direct writes to `bridge_webhook_events`
- Source: `process-pending-events/index.ts`
- Goal: separate lifecycle mutation from attribution/ledger/observability writes

## Classification Matrix

| File | Line | Operation | Fields | Category | Keep Direct? | RPC? |
|---|---:|---|---|---|---|---|
| `supabase/functions/process-pending-events/index.ts` | 542 | `UPDATE` | `target_entity_type`, `target_entity_id` | Attribution | Yes | No |
| `supabase/functions/process-pending-events/index.ts` | 629 | `UPDATE` | `target_entity_type`, `target_entity_id` | Attribution | Yes | No |
| `supabase/functions/process-pending-events/index.ts` | 688 | `UPDATE` | `target_entity_type`, `target_entity_id` | Attribution | Yes | No |
| `supabase/functions/process-pending-events/index.ts` | 702 | `UPDATE` | `target_entity_type`, `target_entity_id` | Attribution | Yes | No |
| `supabase/functions/process-pending-events/index.ts` | 771 | `UPDATE` | `target_entity_type`, `target_entity_id` | Attribution | Yes | No |
| `supabase/functions/process-pending-events/index.ts` | 777 | `UPDATE` | `target_entity_type`, `target_entity_id` | Attribution | Yes | No |
| `supabase/functions/process-pending-events/index.ts` | 808 | `UPDATE` | `target_entity_type`, `target_entity_id` | Attribution | Yes | No |
| `supabase/functions/process-pending-events/index.ts` | 956 | `UPDATE` | `target_entity_type`, `target_entity_id` | Attribution | Yes | No |
| `supabase/functions/process-pending-events/index.ts` | 990 | `UPDATE` | `target_entity_type`, `target_entity_id` | Attribution | Yes | No |

## Totals

- Lifecycle writes: `0`
- Attribution writes: `9`
- Event ledger writes: `0`
- Observability writes: `0`

## Phase C Policy

Phase C blocks only on runtime **lifecycle** writes to lifecycle tables.
Current status for `bridge_webhook_events`: pass (no lifecycle writes remain).

