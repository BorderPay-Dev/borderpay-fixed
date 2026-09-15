import { openHostedVerification } from '../../utils/native/hostedVerification.ts';
const url = 'https://bridge.withpersona.com/verify?inquiry-id=example';
function assert(value: unknown): asserts value { if (!value) throw new Error('assertion failed'); }
Deno.test('native verification uses fullscreen browser without navigating app WebView', async () => {
  let opened = false;
  await openHostedVerification(url, {
    native: true,
    openBrowser: async options => { assert(options.url === url && options.presentationStyle === 'fullscreen'); opened = true; },
    navigateWeb: () => { throw new Error('must not navigate native WebView'); },
  });
  assert(opened);
});
Deno.test('browser failure is surfaced without falling back into native WebView', async () => {
  let rejected = false;
  let navigated = false;
  try {
    await openHostedVerification(url, {
      native: true, openBrowser: async () => { throw new Error('plugin unavailable'); },
      navigateWeb: () => { navigated = true; },
    });
  } catch { rejected = true; }
  assert(rejected && !navigated);
});
Deno.test('web verification uses direct HTTPS navigation', async () => {
  let navigated = '';
  await openHostedVerification(url, {
    native: false, openBrowser: async () => { throw new Error('not native'); },
    navigateWeb: target => { navigated = target; },
  });
  assert(navigated === url);
});
Deno.test('unsafe verification URLs cannot launch', async () => {
  for (const target of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com']) {
    let rejected = false;
    try {
      await openHostedVerification(target, {
        native: true, openBrowser: async () => { throw new Error('should not open'); }, navigateWeb: () => {},
      });
    } catch { rejected = true; }
    assert(rejected);
  }
});
