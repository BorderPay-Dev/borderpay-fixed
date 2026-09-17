// Treasury-only projection. Never infer a missing amount or currency as zero.
const text = (value: unknown) => String(value ?? '').trim();
const amount = (value: unknown) => /^\d+(\.\d+)?$/.test(text(value)) ? text(value) : '';

export function normalizeTreasuryActivity(row: any, kind: 'transfer' | 'virtual_account', context: { sourceCurrency?: string } = {}) {
  const virtual = kind === 'virtual_account';
  const type = text(row?.type || row?.activity_type).toLowerCase();
  const receipt = row?.receipt ?? {};
  const outgoingVa = virtual && ['payment_submitted', 'payment_processed'].includes(type);
  const sourceCurrency = row?.source?.currency || row?.source_currency ||
    (virtual ? (outgoingVa ? context.sourceCurrency : row?.currency) : row?.currency);
  const destinationCurrency = row?.destination?.currency || row?.destination_currency ||
    (outgoingVa ? row?.currency : undefined);
  const state = text(row?.state || row?.status || (virtual ? type : '')).toLowerCase();
  return {
    id: text(virtual ? row?.transfer_id || row?.deposit_id || row?.id : row?.id),
    state: state === 'refund' ? 'refunded' : state,
    activity_kind: kind,
    activity_type: type,
    reference: text(row?.reference || row?.deposit_id || row?.tracking_id),
    source: {
      currency: text(sourceCurrency).toUpperCase(),
      payment_rail: text(row?.source?.payment_rail || row?.source?.rail || row?.payment_rail).toLowerCase(),
      // VA event amount changes meaning across its lifecycle. Receipt initial_amount
      // is explicitly denominated in the fiat/source currency in Bridge's schema.
      amount: amount(row?.source?.amount ?? row?.source_amount ?? receipt.initial_amount ??
        (virtual ? (type === 'funds_received' ? row?.amount : undefined) : row?.amount)),
    },
    destination: {
      currency: text(destinationCurrency).toUpperCase(),
      payment_rail: text(row?.destination?.payment_rail || row?.destination?.rail || row?.destination_payment_rail).toLowerCase(),
      amount: amount(row?.destination?.amount ?? row?.destination_amount ?? receipt.final_amount ?? (outgoingVa ? row?.amount : undefined)),
    },
    created_at: text(row?.created_at),
    updated_at: text(row?.updated_at || row?.created_at),
  };
}

export function mergeTreasuryActivity(...groups: any[][]): any[] {
  const rows = new Map<string, any>();
  for (const row of groups.flat()) {
    if (!row?.id) continue;
    // Account activation/settings events are not financial transactions.
    if (row.activity_kind === 'virtual_account' &&
      ['account_update', 'activation', 'deactivation', 'microdeposit'].includes(row.activity_type)) continue;
    const existing = rows.get(row.id);
    if (!existing || Date.parse(row.updated_at || row.created_at) >= Date.parse(existing.updated_at || existing.created_at)) {
      rows.set(row.id, row);
    }
  }
  return [...rows.values()].sort((a, b) =>
    (Date.parse(b.updated_at || b.created_at) || 0) - (Date.parse(a.updated_at || a.created_at) || 0));
}

// Bound provider work, preserve earlier pages on partial failure, and explicitly
// report truncation. A chart must not describe missing history as zero volume.
export async function readActivityPages(
  fetchPage: (cursor?: string) => Promise<{ ok: boolean; data?: any }>,
  customerId: string,
  maxPages = 5,
): Promise<{ rows: any[]; complete: boolean }> {
  const rows: any[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    let response;
    try { response = await fetchPage(cursor); } catch (error) {
      if (page === 0) throw error;
      return { rows, complete: false };
    }
    if (!response.ok) {
      if (page === 0) throw new Error('Treasury activity unavailable');
      return { rows, complete: false };
    }
    const data = response.data;
    const batch: any[] | undefined = [data?.data, data?.transfers, data?.activities, data?.history, data].find(Array.isArray);
    if (!batch) throw new Error('Invalid treasury activity response');
    // The path is customer-scoped; reject any contradictory ownership evidence.
    if (batch.some(row => (row.on_behalf_of && row.on_behalf_of !== customerId) || (row.customer_id && row.customer_id !== customerId))) {
      throw new Error('Treasury activity ownership mismatch');
    }
    if (batch.some(row => !text(row.id) || seen.has(text(row.id)))) return { rows, complete: false };
    for (const row of batch) { seen.add(text(row.id)); rows.push(row); }
    if (!batch.length || (batch.length < 100 && data?.has_more !== true)) return { rows, complete: true };
    cursor = text(batch[batch.length - 1].id);
  }
  return { rows, complete: false };
}
