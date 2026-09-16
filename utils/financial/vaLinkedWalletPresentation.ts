const ACTIVE_STATUSES = new Set(['active', 'activated', 'approved', 'enabled', 'ready', 'provisioned']);
const BASE_ASSETS = new Set(['USDC', 'EURC']);

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function destinationFor(virtualAccount: any): Record<string, unknown> | null {
  const details = virtualAccount?.account_details ?? virtualAccount;
  if (!details || typeof details !== 'object') return null;
  const synced = details.bridge_sync_raw;
  // A successful Bridge read supersedes historical local routing metadata.
  const source = synced && typeof synced === 'object' && 'destination' in synced
    ? synced : details;
  const destination = source.destination;
  return destination && typeof destination === 'object' ? destination : null;
}

/** Select a resource, never the first of several possible Base wallets. */
export function selectVaLinkedBaseWallet(walletRows: unknown, virtualAccountRows: unknown): any | null {
  const wallets: any[] = Array.isArray(walletRows) ? walletRows : [];
  const virtualAccounts: any[] = Array.isArray(virtualAccountRows) ? virtualAccountRows : [];
  const walletId = (row: any) => String(row?.bridge_wallet_id ?? row?.wallet_id ?? '').trim();
  const activeBaseWallets = wallets.filter((row: any) =>
    normalized(row?.chain ?? row?.payment_rail) === 'base' &&
    ACTIVE_STATUSES.has(normalized(row?.status)) && walletId(row),
  );
  const resources = new Map(activeBaseWallets.map(row => [walletId(row), row]));
  const activeVas = virtualAccounts.filter(row => ACTIVE_STATUSES.has(normalized(row?.status)));
  const linked = new Set<string>();
  for (const va of activeVas) {
    const destination = destinationFor(va);
    if (!destination || normalized(destination.payment_rail) !== 'base' ||
        !BASE_ASSETS.has(String(destination.currency ?? '').trim().toUpperCase())) return null;
    let id = String(destination.bridge_wallet_id ?? '').trim();
    if (!id) {
      const address = normalized(destination.address);
      const matches = [...resources.values()].filter(row => address && normalized(row.address) === address);
      if (matches.length !== 1) return null;
      id = walletId(matches[0]);
    }
    if (!resources.has(id)) return null;
    linked.add(id);
  }
  if (linked.size === 1) return resources.get([...linked][0]) ?? null;
  if (activeVas.length) return null;
  // Newly approved customers can have their automatic wallet before any VA.
  // With multiple resources, wait for authoritative routing instead of guessing.
  return resources.size === 1 ? [...resources.values()][0] : null;
}

/**
 * EEA Base wallets can expose both EURC and USDC under one provider wallet ID.
 * When every active Base-denominated VA points to the same EURC-capable wallet,
 * that VA-linked wallet is authoritative for customer presentation. Other Base
 * resources are excluded from this view. Provider records are left untouched.
 */
export function selectVaLinkedStablecoinWallets(
  walletRows: unknown,
  virtualAccountRows: unknown,
  options: { allowUsdtTron?: boolean; allowEurcBase?: boolean; includeWithdrawalAssets?: boolean } = {},
): any[] {
  const wallets = Array.isArray(walletRows) ? walletRows : [];
  const authoritative = selectVaLinkedBaseWallet(wallets, virtualAccountRows);
  const canonicalRows = authoritative ? (() => {
    const authoritativeWalletId = String(
    authoritative?.bridge_wallet_id ?? authoritative?.wallet_id ?? authoritative?.id ?? 'base',
    ).trim();

    // One Base resource supports both assets. Show EURC for EEA accounts;
    // non-EEA wallets show USDC here and their separate USDT/Tron wallet below.
    return (options.allowEurcBase ? ['USDC', 'EURC'] : ['USDC']).map((asset) => ({
      ...authoritative,
      currency: asset,
      presentation_id: `${authoritativeWalletId}:${asset}`,
    }));
  })() : [];

  // USDT is a separate Tron wallet for verified non-EEA customers. It is not
  // VA-linked and must never be synthesized from the Base wallet.
  const tronUsdt = options.allowUsdtTron
    ? wallets.find((row: any) =>
        normalized(row?.chain ?? row?.payment_rail) === 'tron'
        && String(row?.currency || '').trim().toUpperCase() === 'USDT'
        && ACTIVE_STATUSES.has(normalized(row?.status)))
    : null;
  if (tronUsdt) {
    const walletId = String(tronUsdt?.bridge_wallet_id ?? tronUsdt?.wallet_id ?? tronUsdt?.id ?? 'tron').trim();
    canonicalRows.push({ ...tronUsdt, currency: 'USDT', presentation_id: `${walletId}:USDT` });
  }

  return canonicalRows;
}
