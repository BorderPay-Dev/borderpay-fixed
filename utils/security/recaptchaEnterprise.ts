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

function loadEnterpriseApi(forceReload = false): Promise<void> {
  if (window.grecaptcha?.enterprise) return Promise.resolve();
  if (loader) return loader;

  loader = new Promise<void>((resolve, reject) => {
    let existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (forceReload && existing) {
      existing.remove();
      existing = null;
    }
    const script = existing || document.createElement('script');
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (error) {
        loader = null;
        reject(error);
      } else {
        resolve();
      }
    };
    const timeout = window.setTimeout(
      () => finish(new Error('Signup verification timed out.')),
      12_000,
    );
    script.addEventListener('load', () => {
      if (window.grecaptcha?.enterprise) finish();
      else finish(new Error('Signup verification did not initialize.'));
    }, { once: true });
    script.addEventListener('error', () => {
      finish(new Error('Signup verification could not be loaded.'));
    }, { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.async = true;
      script.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(SITE_KEY)}`;
      document.head.appendChild(script);
    } else {
      // A previously loaded script can exist before the Enterprise namespace
      // becomes visible. Poll briefly instead of waiting for a load event that
      // has already fired.
      const poll = window.setInterval(() => {
        if (!window.grecaptcha?.enterprise) return;
        window.clearInterval(poll);
        finish();
      }, 50);
      window.setTimeout(() => window.clearInterval(poll), 12_000);
    }
  });
  return loader;
}

/**
 * Returns no token until a web site key is configured. Native clients use
 * Firebase App Check / platform attestation instead of a browser site key.
 */
export async function executeEnterpriseRecaptcha(action: 'SIGNUP'): Promise<string | undefined> {
  if (isNativeRuntime()) return undefined;
  if (!SITE_KEY) throw new Error('Signup verification is temporarily unavailable. Please try again later.');
  try {
    await loadEnterpriseApi();
  } catch {
    await loadEnterpriseApi(true);
  }
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
