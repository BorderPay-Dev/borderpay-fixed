/** A failed/partial refresh cannot prove a saved destination was removed. */
export function reconcileSavedBankAccounts<T extends { bridge_external_account_id: string }>(
  current: T[], incoming: T[], complete: boolean,
): T[] {
  if (complete) return incoming;
  const rows = new Map(current.map(row => [row.bridge_external_account_id, row]));
  for (const row of incoming) rows.set(row.bridge_external_account_id, row);
  return [...rows.values()];
}
