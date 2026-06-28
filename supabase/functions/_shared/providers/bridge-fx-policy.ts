import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const BRIDGE_FX_FALLBACK_SUPPORTED_PAIRS = new Set([
  "USD_BRL", "BRL_USD",
  "USD_COP", "COP_USD",
  "USD_EUR", "EUR_USD",
  "USD_GBP", "GBP_USD",
  "USD_MXN", "MXN_USD",
  "USD_USDT", "USDT_USD",
]);

export function parseSupportedFxPairsConfig(value: unknown): Set<string> | null {
  if (value == null) return null;
  const source = Array.isArray(value)
    ? value
    : (value && typeof value === "object" && Array.isArray((value as { supported_pairs?: unknown[] }).supported_pairs))
    ? (value as { supported_pairs: unknown[] }).supported_pairs
    : null;
  if (!source) return new Set<string>();
  const out = new Set<string>();
  for (const raw of source) {
    const normalized = String(raw || "").trim().toUpperCase();
    if (/^[A-Z0-9]{2,10}_[A-Z0-9]{2,10}$/.test(normalized)) out.add(normalized);
  }
  return out;
}

export async function loadSupportedFxPairsFromSettings(
  supa: SupabaseClient,
): Promise<Set<string> | null> {
  const { data } = await supa
    .from("provider_settings")
    .select("value")
    .eq("key", "bridge.fx.supported_pairs")
    .maybeSingle();
  return parseSupportedFxPairsConfig(data?.value ?? null);
}
