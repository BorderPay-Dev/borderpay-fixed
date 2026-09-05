import { isNativeRuntime } from '../native/mobileRuntime';

const SITE_KEY = String(import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || '').trim();
const SCRIPT_ID = 'borderpay-recaptcha-enterprise';

type EnterpriseApi = {
  ready(callback: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
};

declare global {
  interface Window {
    grecaptcha?: { enterprise?: EnterpriseApi };
  }
}

let loader: Promise<void> | null = null;

function loadEnterpriseApi(): Promise<void> {
  if (window.grecaptcha?.enterprise) return Promise.resolve();
  if (loader) return loader;

  loader = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing || document.createElement('script');
    const timeout = window.setTimeout(() => reject(new Error('Signup verification timed out.')), 10_000);
    script.addEventListener('load', () => {
      window.clearTimeout(timeout);
      if (window.grecaptcha?.enterprise) resolve();
      else reject(new Error('Signup verification did not initialize.'));
    }, { once: true });
    script.addEventListener('error', () => {
      window.clearTimeout(timeout);
      reject(new Error('Signup verification could not be loaded.'));
    }, { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.async = true;
      script.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(SITE_KEY)}`;
      document.head.appendChild(script);
    }
  });
  return loader;
}

/**
 * Returns no token until a web site key is configured. Native clients use
 * Firebase App Check / platform attestation instead of a browser site key.
 */
export async function executeEnterpriseRecaptcha(action: 'SIGNUP'): Promise<string | undefined> {
  if (!SITE_KEY || isNativeRuntime()) return undefined;
  await loadEnterpriseApi();
  const enterprise = window.grecaptcha?.enterprise;
  if (!enterprise) throw new Error('Signup verification is unavailable.');
  return await new Promise<string>((resolve, reject) => {
    enterprise.ready(() => {
      enterprise.execute(SITE_KEY, { action })
        .then((token) => token ? resolve(token) : reject(new Error('Signup verification returned no token.')))
        .catch(() => reject(new Error('Signup verification failed. Please retry.')));
    });
  });
}
