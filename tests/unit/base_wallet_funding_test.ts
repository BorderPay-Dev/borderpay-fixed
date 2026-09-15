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
    const funding = selectVaLinkedStablecoinWallets(rows, vas, { allowUsdtTron });
    assert(allowUsdtTron ? !funding.some(w => w.currency === 'EURC') : funding.find(w => w.currency === 'EURC')?.bridge_wallet_id === 'funded', 'EURC must carry the linked source ID for EEA and stay hidden for non-EEA');
    assert(funding.find(w => w.currency === 'USDC')?.bridge_wallet_id === 'funded', 'USDC must use the same Base resource');
    assert(funding.some(w => w.currency === 'USDT') === allowUsdtTron, 'USDT region boundary must remain');
    assert(!funding.some(w => w.bridge_wallet_id === 'duplicate'), 'duplicate resource must not become funding source');
  }
  const noActiveWallet = selectVaLinkedStablecoinWallets(rows.map(w => ({ ...w, status: 'closed' })), vas);
  assert(noActiveWallet.length === 0, 'closed wallets must not be synthesized as active assets');
});
