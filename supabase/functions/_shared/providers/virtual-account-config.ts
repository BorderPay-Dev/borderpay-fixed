export type VaCurrency = "USD" | "EUR" | "GBP";

export type VirtualAccountDestinationConfig = {
  payment_rail: string;
  currency: string;
  address: string;
};

const DEFAULT_VA_DEVELOPER_FEE_PERCENT = "2.5";

function normalizeDeveloperFeePercent(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return String(Number(n.toFixed(4)));
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function normalizeDestination(value: unknown): VirtualAccountDestinationConfig | null {
  const raw = readObject(value);
  if (!raw) return null;

  const paymentRail = String(raw.payment_rail ?? raw.rail ?? "").trim();
  const currency = String(raw.currency ?? "").trim().toUpperCase();
  const address = String(raw.address ?? raw.destination_address ?? "").trim();
  if (!paymentRail || !currency || !address) return null;

  return {
    payment_rail: paymentRail,
    currency,
    address,
  };
}

async function loadProviderSetting(supa: any, key: string): Promise<unknown> {
  const { data, error } = await supa
    .from("provider_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.warn(`provider_settings lookup failed for ${key}: ${error.message}`);
    return null;
  }
  return data?.value ?? null;
}

function destinationFromEnv(currency: VaCurrency): VirtualAccountDestinationConfig | null {
  const prefix = `BRIDGE_VA_${currency}_DESTINATION`;
  return normalizeDestination({
    payment_rail:
      Deno.env.get(`${prefix}_PAYMENT_RAIL`) ??
      Deno.env.get(`${prefix}_RAIL`) ??
      Deno.env.get("BRIDGE_VA_DESTINATION_PAYMENT_RAIL") ??
      Deno.env.get("BRIDGE_VA_DESTINATION_RAIL"),
    currency:
      Deno.env.get(`${prefix}_CURRENCY`) ??
      Deno.env.get("BRIDGE_VA_DESTINATION_CURRENCY"),
    address:
      Deno.env.get(`${prefix}_ADDRESS`) ??
      Deno.env.get("BRIDGE_VA_DESTINATION_ADDRESS"),
  });
}

export async function loadVirtualAccountDeveloperFeePercent(supa: any): Promise<string> {
  const fromSetting = normalizeDeveloperFeePercent(
    await loadProviderSetting(supa, "bridge.virtual_account.developer_fee_percent"),
  );
  if (fromSetting) return fromSetting;

  const fromEnv = normalizeDeveloperFeePercent(Deno.env.get("BRIDGE_VA_DEVELOPER_FEE_PERCENT"));
  return fromEnv ?? DEFAULT_VA_DEVELOPER_FEE_PERCENT;
}

export async function loadVirtualAccountDestinationConfig(
  supa: any,
  currency: VaCurrency,
): Promise<VirtualAccountDestinationConfig> {
  const exact = normalizeDestination(
    await loadProviderSetting(supa, `bridge.virtual_account.destination.${currency}`),
  );
  if (exact) return exact;

  const shared = await loadProviderSetting(supa, "bridge.virtual_account.destination");
  const sharedObj = readObject(shared);
  const byCurrency = sharedObj ? normalizeDestination(sharedObj[currency]) : null;
  if (byCurrency) return byCurrency;
  const sharedFlat = normalizeDestination(shared);
  if (sharedFlat) return sharedFlat;

  const env = destinationFromEnv(currency);
  if (env) return env;

  throw new Error(
    `Bridge virtual-account destination config missing for ${currency}; set provider_settings bridge.virtual_account.destination.${currency} or BRIDGE_VA_${currency}_DESTINATION_* secrets`,
  );
}
