/**
 * Provider registry — Bridge-only runtime selection.
 *
 * Selection rules (fail-closed):
 *   • payment_provider IS NULL / empty → Bridge (default).
 *   • payment_provider === 'bridge'    → Bridge.
 *   • any other value                  → throw unsupported.
 *
 * We never reinterpret explicit non-Bridge provider values as Bridge.
 */

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { PaymentProvider, ProviderName } from "./types.ts";
import { bridgeProvider }  from "./bridge.ts";

let _supa: SupabaseClient | null = null;
function supa(): SupabaseClient {
  if (_supa) return _supa;
  _supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _supa;
}

const PROVIDERS: Record<ProviderName, PaymentProvider> = {
  bridge: bridgeProvider,
};

export async function getProviderForUser(userId: string): Promise<PaymentProvider> {
  const { data } = await supa()
    .from("user_profiles")
    .select("payment_provider")
    .eq("id", userId)
    .maybeSingle();
  const raw = (data?.payment_provider ?? "").toString().trim();

  // Missing → use the configured default (which is Bridge).
  if (raw === "") {
    return getProviderByName(await getDefaultProviderName());
  }

  // Explicit live provider.
  if (raw === "bridge") return getProviderByName("bridge");

  // Anything else (legacy values, typos, unknown values): fail closed.
  // We never reinterpret an explicit non-Bridge provider as Bridge.
  throw new Error(`Provider '${raw}' has been removed or is unsupported`);
}

/**
 * The default provider for new signups / records with no explicit provider.
 * Always Bridge. Not used as a fallback for explicit non-Bridge values.
 */
export async function getDefaultProviderName(): Promise<ProviderName> {
  return "bridge";
}

export function getProviderByName(name: ProviderName): PaymentProvider {
  return PROVIDERS[name];
}
