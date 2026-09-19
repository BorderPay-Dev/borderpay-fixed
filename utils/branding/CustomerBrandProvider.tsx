import React, { useEffect, useState } from "react";
import { ANON_KEY, BASE_URL, supabase } from "../supabase/client";
import { isNativeRuntime } from "../native/mobileRuntime";
import { type CustomerBrand, setCustomerBrand } from "./brand";
import { validateWhiteLabelBrand } from "../../supabase/functions/_shared/white-label-config";
const directHosts = new Set([
  "app.borderpayafrica.com",
  "localhost",
  "127.0.0.1",
]);
function directApp() {
  return isNativeRuntime() || directHosts.has(location.hostname) ||
    (/^borderpay-(recovery|fixed)(-[a-z0-9-]+)?\.vercel\.app$/.test(
      location.hostname,
    ));
}
export function CustomerBrandProvider(
  { children }: { children: React.ReactNode },
) {
  const [ready, setReady] = useState(directApp),
    [error, setError] = useState("");
  useEffect(() => {
    if (directApp()) return;
    let alive = true, generation = 0;
    const configure = async (token?: string) => {
      const call = ++generation;
      setReady(false);
      setError("");
      try {
        const response = await fetch(
          `${BASE_URL}/white-label-config?origin=${
            encodeURIComponent(location.origin)
          }`,
          {
            headers: {
              apikey: ANON_KEY,
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            cache: "no-store",
            signal: AbortSignal.timeout(12000),
          },
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Customer app unavailable.");
        }
        const config: CustomerBrand = {
          ...payload,
          brand: validateWhiteLabelBrand(payload.brand),
        };
        if (config.brand.app_origin !== location.origin) {
          throw new Error("Customer app domain mismatch.");
        }
        if (!alive || call !== generation) return;
        setCustomerBrand(config);
        const b = config.brand;
        document.title = b.brand_name;
        for (const key of ["og:title", "twitter:title"]) {
          document.querySelector(`meta[property="${key}"]`)?.setAttribute(
            "content",
            b.brand_name,
          );
        }
        for (const key of ["og:description", "twitter:description"]) {
          document.querySelector(`meta[property="${key}"]`)?.setAttribute(
            "content",
            `Your ${b.brand_name} account`,
          );
        }
        document.querySelector('meta[name="description"]')?.setAttribute(
          "content",
          `Your ${b.brand_name} account`,
        );
        document.querySelector('meta[property="og:url"]')?.setAttribute(
          "content",
          b.app_origin,
        );
        document.querySelector('meta[property="og:image"]')?.setAttribute(
          "content",
          b.logo_url,
        );
        document.documentElement.style.setProperty(
          "--brand-accent",
          b.primary_color,
        );
        document.documentElement.style.setProperty(
          "--brand-accent-rgb",
          [1, 3, 5].map((i) => parseInt(b.primary_color.slice(i, i + 2), 16))
            .join(" "),
        );
        document.documentElement.dataset.customerBrand = "partner";
        document.querySelector('meta[name="apple-mobile-web-app-title"]')
          ?.setAttribute("content", b.brand_name);
        document.querySelector('meta[name="theme-color"]')?.setAttribute(
          "content",
          b.primary_color,
        );
        for (
          const link of document.querySelectorAll<HTMLLinkElement>(
            'link[rel="icon"],link[rel="apple-touch-icon"]',
          )
        ) link.href = b.logo_url;
        // Partner PWA identity is generated only from validated public config.
        const manifest = document.querySelector<HTMLLinkElement>(
          'link[rel="manifest"]',
        );
        if (manifest) {
          manifest.href = `${BASE_URL}/white-label-config?origin=${
            encodeURIComponent(location.origin)
          }&format=manifest`;
        }
        setReady(true);
      } catch (e) {
        if (alive && call === generation) {
          setError(
            e instanceof Error ? e.message : "Unable to load customer app.",
          );
        }
      }
    };
    void supabase.auth.getSession().then(({ data, error }) =>
      error ? setError("Sign in again.") : configure(data.session?.access_token)
    );
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
          void configure(session?.access_token);
        }
      },
    );
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);
  if (!ready) {
    return (
      <main
        className="min-h-screen bg-[#0B0E11] text-white flex flex-col items-center justify-center p-8 gap-4"
        role="status"
      >
        <p>{error || "Loading your customer app…"}</p>
        {error && (
          <>
            <button onClick={() => location.reload()}>Try again</button>
            <button onClick={() => void supabase.auth.signOut()}>
              Sign out
            </button>
          </>
        )}
      </main>
    );
  }
  return <>{children}</>;
}
