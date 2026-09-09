const EEA_30 = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR',
  'GR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO',
  'SE', 'SI', 'SK', 'IS', 'LI', 'NO',
]);

const ACTIVE_WALLET_STATUSES = new Set([
  'active', 'approved', 'enabled', 'ready', 'provisioned',
]);

type WalletLike = Record<string, any>;

const countryCode = (value: unknown) => String(value || '').trim().toUpperCase();
const walletStatus = (row: WalletLike) => String(row?.status || row?.state || '').trim().toLowerCase();
const walletChain = (row: WalletLike) => String(row?.chain || row?.network || '').trim().toLowerCase();
const walletCurrency = (row: WalletLike) => String(row?.currency || row?.symbol || '').trim().toUpperCase();
const rowTimestamp = (row: WalletLike) => Date.parse(String(row?.updated_at || row?.created_at || '')) || 0;

export function isEea30Country(country: unknown): boolean {
  return EEA_30.has(countryCode(country));
}

/**
 * Bridge custody is chain-scoped: one active Base wallet supports both USDC
 * and EURC. Present two asset views while hiding legacy Tron for EEA users.
 */
export function projectEeaBridgeWalletRows<T extends WalletLike>(
  rows: readonly T[] | null | undefined,
  country: unknown,
): T[] {
  const sourceRows = Array.isArray(rows) ? [...rows] : [];
  if (!isEea30Country(country)) return sourceRows;

  const activeBaseRows = sourceRows
    .filter((row) => walletChain(row) === 'base')
    .filter((row) => ACTIVE_WALLET_STATUSES.has(walletStatus(row)))
    .sort((a, b) => rowTimestamp(b) - rowTimestamp(a));
  if (activeBaseRows.length === 0) return [];

  const providerWallet = activeBaseRows[0];
  const providerWalletId = providerWallet.bridge_wallet_id || providerWallet.id;
  return (['USDC', 'EURC'] as const).map((currency) => {
    const existing = activeBaseRows.find((row) => walletCurrency(row) === currency);
    if (existing) return { ...existing, currency, chain: 'base' } as T;
    return {
      ...providerWallet,
      id: `${providerWallet.id || providerWalletId}:asset:${currency.toLowerCase()}`,
      bridge_wallet_id: providerWalletId,
      currency,
      chain: 'base',
      display_asset: true,
    } as T;
  });
}

/** Adds zero-balance asset rows without copying a USDC balance into EURC. */
export function projectEeaCanonicalWalletRows<T extends WalletLike>(
  rows: readonly T[] | null | undefined,
  bridgeWalletRows: readonly WalletLike[] | null | undefined,
  country: unknown,
): T[] {
  const sourceRows = Array.isArray(rows) ? [...rows] : [];
  if (!isEea30Country(country)) return sourceRows;

  const assets = projectEeaBridgeWalletRows(bridgeWalletRows, country);
  if (assets.length === 0) return sourceRows.filter((row) => !row?.bridge_wallet_id);

  const providerWalletId = assets[0].bridge_wallet_id || assets[0].id;
  const byCurrency = new Map<string, T>();
  sourceRows.forEach((row) => {
    const currency = walletCurrency(row);
    if (row?.bridge_wallet_id && currency !== 'USDC' && currency !== 'EURC') return;
    byCurrency.set(currency, row);
  });

  for (const currency of ['USDC', 'EURC'] as const) {
    const existing = byCurrency.get(currency);
    byCurrency.set(currency, {
      ...(existing || {}),
      id: existing?.id || `canonical:${currency}`,
      currency,
      balance: Number(existing?.balance || 0),
      status: 'active',
      provider: existing?.provider || 'bridge',
      bridge_wallet_id: providerWalletId,
      chain: 'base',
    } as unknown as T);
  }
  return Array.from(byCurrency.values());
}
