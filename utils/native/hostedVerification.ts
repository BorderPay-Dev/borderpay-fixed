/** Hosted identity verification must never navigate the native app WebView. */
export async function openHostedVerification(
  url: string,
  runtime: {
    native: boolean;
    openBrowser: (options: { url: string; presentationStyle: 'fullscreen' }) => Promise<unknown>;
    navigateWeb: (url: string) => void;
  },
): Promise<void> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password) {
    throw new Error('Invalid secure verification link');
  }
  if (runtime.native) {
    // A rejected Browser.open is surfaced to the user. Falling back to
    // location.assign would load Persona in WKWebView/Android WebView.
    await runtime.openBrowser({ url: target.toString(), presentationStyle: 'fullscreen' });
    return;
  }
  runtime.navigateWeb(target.toString());
}
