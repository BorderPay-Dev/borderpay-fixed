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

// Global error handler
window.addEventListener('error', (event) => {
  console.error('❌ Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('❌ Unhandled promise rejection:', event.reason);
});

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

console.log('✅ React app initialized');

// ── Register Service Worker for PWA (iOS + Android) ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((reg) => {
        console.log('✅ SW registered:', reg.scope);
      })
      .catch((err) => {
        console.warn('⚠️ SW registration failed:', err);
      });
  });
}