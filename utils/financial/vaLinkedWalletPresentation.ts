const ACTIVE_STATUSES = new Set(['active', 'activated', 'approved', 'enabled', 'ready', 'provisioned']);
const BASE_ASSETS = new Set(['USDC', 'EURC']);

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function destinationFor(virtualAccount: any): Record<string, unknown> | null {
  const details = virtualAccount?.account_details;
  if (!details || typeof details !== 'object') return null;

  const direct = details.destination;
  if (direct && typeof direct === 'object') return direct as Record<string, unknown>;

  const synced = details.bridge_sync_raw;
  if (!synced || typeof synced !== 'object') return null;
  const nested = (synced as Record<string, unknown>).destination;
  return nested && typeof nested === 'object' ? nested as Record<string, unknown> : null;
}

/**
 * EEA Base wallets can expose both EURC and USDC under one provider wallet ID.
 * When every active Base-denominated VA points to the same EURC-capable wallet,
 * that VA-linked wallet is authoritative for customer presentation. Any other
 * Base wallet row is a provisioning duplicate and must not appear as active in
 * BorderPay. Provider records are intentionally left untouched.
 */
export function selectVaLinkedStablecoinWallets(
  walletRows: unknown,
  virtualAccountRows: unknown,
  options: { allowUsdtTron?: boolean; allowEurcBase?: boolean; includeWithdrawalAssets?: boolean } = {},
): any[] {
  const wallets = Array.isArray(walletRows) ? walletRows : [];
  const virtualAccounts = Array.isArray(virtualAccountRows) ? virtualAccountRows : [];
  const linkedAssetsByWallet = new Map<string, Set<string>>();

  for (const virtualAccount of virtualAccounts) {
    if (!ACTIVE_STATUSES.has(normalized(virtualAccount?.status))) continue;
    const destination = destinationFor(virtualAccount);
    if (!destination || normalized(destination.payment_rail) !== 'base') continue;

    const walletId = String(destination.bridge_wallet_id ?? '').trim();
    const asset = String(destination.currency ?? '').trim().toUpperCase();
    if (!walletId || !BASE_ASSETS.has(asset)) continue;

    const assets = linkedAssetsByWallet.get(walletId) ?? new Set<string>();
    assets.add(asset);
    linkedAssetsByWallet.set(walletId, assets);
  }

  const linkedWalletId = linkedAssetsByWallet.size === 1
    ? Array.from(linkedAssetsByWallet.keys())[0]
    : '';
  const activeBaseWallets = wallets.filter((row: any) =>
    normalized(row?.chain ?? row?.payment_rail) === 'base' &&
    ACTIVE_STATUSES.has(normalized(row?.status)),
  );
  const authoritative = activeBaseWallets.find((row: any) =>
    String(row?.bridge_wallet_id ?? row?.wallet_id ?? '').trim() === linkedWalletId,
  ) ?? activeBaseWallets[0];
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
