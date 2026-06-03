/**
 * Provider registry — single function to resolve which provider to use for
 * a given user. Bridge is the only live provider. African on/off-ramp is a
 * future-state placeholder with no live implementation yet.
 *
 * Selection rules (fail-closed):
 *   • payment_provider IS NULL / empty     → Bridge (default for new users).
 *   • payment_provider === 'bridge'        → Bridge.
 *   • payment_provider === 'african_onramp'→ throw (not yet implemented).
 *   • any other value                      → throw `Provider '<value>' has
 *     been removed or is unsupported`. We deliberately DO NOT reinterpret an
 *     explicit non-live provider value as Bridge — those rows may not have
 *     Bridge customer state, and silently routing them to Bridge could create
 *     stranded customer rows or duplicate identities.
 *
 * `getDefaultProviderName()` is consulted only for missing/default settings,
 * never as a rescue for a removed provider value.
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

const PROVIDERS: Record<ProviderName, PaymentProvider | null> = {
  bridge:         bridgeProvider,
  african_onramp: null,    // future-state (planned Yativo integration); no live calls
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

  // Explicit future-state provider — surface as not-implemented (do NOT
  // silently route to Bridge; the user has been explicitly assigned a
  // different rail).
  if (raw === "african_onramp") {
    throw new Error("Provider 'african_onramp' is not yet implemented");
  }

  // Anything else (legacy values, typos, future unknown values): fail closed.
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
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Provider '${name}' not registered`);
  return p;
}
