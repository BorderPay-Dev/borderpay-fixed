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

// Remove the initial HTML splash screen as soon as React starts rendering
setTimeout(() => {
  document.body.classList.add('react-loaded');
}, 0);

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

// Register Service Worker for PWA (iOS + Android)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }).then((registration) => {
      // Force update check on launch so live users receive hotfixes quickly.
      registration.update().catch(() => {});

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          // Do not force-activate/reload in active sessions; let SW activate
          // naturally on next app open to avoid auth/session disruption.
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // no-op by design
          }
        });
      });

      // Keep checking in active sessions (low frequency) without forced reload.
      const runUpdateCheck = () => registration.update().catch(() => {});
      const intervalId = window.setInterval(runUpdateCheck, 15 * 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') runUpdateCheck();
      });
      window.addEventListener('beforeunload', () => window.clearInterval(intervalId));
    }).catch(() => {});
  });
}
