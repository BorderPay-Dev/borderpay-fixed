import { selectVaLinkedStablecoinWallets } from '../../utils/financial/vaLinkedWalletPresentation.ts';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

Deno.test('USDC-labelled Base resource exposes EURC funding with its VA-linked provider wallet ID', () => {
  const rows = [
    { bridge_wallet_id: 'duplicate', currency: 'USDC', chain: 'base', status: 'active' },
    { bridge_wallet_id: 'funded', currency: 'USDC', chain: 'base', status: 'active' },
    { bridge_wallet_id: 'tron-wallet', currency: 'USDT', chain: 'tron', status: 'active' },
  ];
  const vas = [{ status: 'active', account_details: { destination: { payment_rail: 'base', currency: 'EURC', bridge_wallet_id: 'funded' } } }];
  for (const allowUsdtTron of [false, true]) {
    const funding = selectVaLinkedStablecoinWallets(rows, vas, { allowUsdtTron, allowEurcBase: !allowUsdtTron });
    assert(allowUsdtTron ? !funding.some(w => w.currency === 'EURC') : funding.find(w => w.currency === 'EURC')?.bridge_wallet_id === 'funded', 'EURC must carry the linked source ID for EEA and stay hidden for non-EEA');
    assert(funding.find(w => w.currency === 'USDC')?.bridge_wallet_id === 'funded', 'USDC must use the same Base resource');
    assert(funding.some(w => w.currency === 'USDT') === allowUsdtTron, 'USDT region boundary must remain');
    assert(!funding.some(w => w.bridge_wallet_id === 'duplicate'), 'duplicate resource must not become funding source');
  }
  const withdrawalFunding = selectVaLinkedStablecoinWallets(rows, vas, { allowUsdtTron: true, includeWithdrawalAssets: true });
  assert(!withdrawalFunding.some(w => w.currency === 'EURC'), 'withdrawal must not bypass the non-EEA EURC boundary');
  assert(withdrawalFunding.map(w => w.currency).join(',') === 'USDC,USDT', 'non-EEA withdrawal must retain only USDC and USDT');
  const noActiveWallet = selectVaLinkedStablecoinWallets(rows.map(w => ({ ...w, status: 'closed' })), vas);
  assert(noActiveWallet.length === 0, 'closed wallets must not be synthesized as active assets');
});

Deno.test('latest Bridge destination wins over stale local routing and wallet order', () => {
  const wallets = [
    { bridge_wallet_id: 'old', currency: 'USDC', chain: 'base', status: 'active', address: '0xold' },
    { bridge_wallet_id: 'linked', currency: 'USDC', chain: 'base', status: 'active', address: '0xlinked' },
  ];
  const route = (id: string) => ({ payment_rail: 'base', currency: 'USDC', bridge_wallet_id: id });
  const vas = [{ status: 'active', account_details: {
    destination: route('old'), bridge_sync_raw: { destination: route('linked') },
  } }];
  for (const rows of [wallets, [...wallets].reverse()]) {
    const selected = selectVaLinkedStablecoinWallets(rows, vas, { allowEurcBase: true });
    assert(selected.length === 2 && selected.every(w => w.bridge_wallet_id === 'linked'), 'both assets must use the API-linked resource');
  }
  const addressOnly = [{ status: 'active', account_details: { destination: { payment_rail: 'base', currency: 'EURC', address: '0xLINKED' } } }];
  assert(selectVaLinkedStablecoinWallets(wallets, addressOnly)[0]?.bridge_wallet_id === 'linked', 'resolve API address against owned Base resources');
  for (const routes of [[],
    [{ status: 'active', account_details: { destination: route('missing') } }],
    [{ status: 'active', account_details: { destination: route('old') } }, { status: 'active', account_details: { destination: route('linked') } }],
    [{ status: 'active', account_details: { destination: route('old'), bridge_sync_raw: { destination: null } } }],
  ]) {
    assert(selectVaLinkedStablecoinWallets(wallets, routes, { allowEurcBase: true }).length === 0, 'unresolved or conflicting links cannot select an arbitrary wallet');
  }
  assert(selectVaLinkedStablecoinWallets([wallets[0]], [], { allowEurcBase: true }).length === 2, 'automatic wallet remains visible before first VA');
  const tron = { bridge_wallet_id: 'tron', currency: 'USDT', chain: 'tron', status: 'active' };
  const nonEea = selectVaLinkedStablecoinWallets([...wallets, tron], [], { allowUsdtTron: true });
  assert(nonEea.length === 1 && nonEea[0].currency === 'USDT', 'unresolved Base links never hide the separate non-EEA Tron wallet');
});
