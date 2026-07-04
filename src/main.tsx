import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../App';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import '../styles/globals.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

// Boot marker used by index.html emergency recovery guard.
try {
  (window as any).__BORDERPAY_BOOT_OK__ = true;
} catch {
  // noop
}

// Keep the initial HTML splash visible a bit longer to avoid blank/unstyled
// startup frames on slower devices before React paints the branded splash.
setTimeout(() => {
  document.body.classList.add('react-loaded');
}, 700);

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Hard-disable Brevo website widget in the app runtime.
// The main app uses internal support flows only.
function removeBrevoWidgetArtifacts(): void {
  try {
    // Remove script tags that load Brevo conversations.
    document
      .querySelectorAll('script[src*="conversations-widget.brevo.com"],script[src*="brevo-conversations.js"]')
      .forEach((n) => n.remove());

    // Remove Brevo iframes/launchers if already injected.
    document
      .querySelectorAll('iframe[src*="brevo"],iframe[id*="brevo"],div[id*="brevo"],div[class*="brevo"]')
      .forEach((n) => n.remove());

    // Remove known global handles.
    (window as any).BrevoConversations = undefined;
    (window as any).BrevoConversationsID = undefined;
  } catch {
    // noop
  }
}

removeBrevoWidgetArtifacts();
const brevoWidgetObserver = new MutationObserver(() => removeBrevoWidgetArtifacts());
brevoWidgetObserver.observe(document.documentElement, { childList: true, subtree: true });

// Sev-1 production safety: disable SW registration and purge stale workers/caches.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
    if ('caches' in window) {
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {});
    }
  });
}
