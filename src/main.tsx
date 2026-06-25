import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../App';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import '../styles/globals.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

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

// Register Service Worker for PWA (iOS + Android)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }).then((registration) => {
      // Force update check on launch so live users receive hotfixes quickly.
      registration.update().catch(() => {});

      // Catch already-waiting workers on launch.
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      // Keep checking in active sessions so users get patched without uninstall.
      const runUpdateCheck = () => registration.update().catch(() => {});
      const intervalId = window.setInterval(runUpdateCheck, 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') runUpdateCheck();
      });
      window.addEventListener('beforeunload', () => window.clearInterval(intervalId));
    }).catch(() => {});

    // Reload once when a new service worker takes control.
    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshed) return;
      refreshed = true;
      window.location.reload();
    });
  });
}
