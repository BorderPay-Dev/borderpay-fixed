export type VaCurrency = "USD" | "EUR" | "GBP";

import { bridgeProvider } from "./bridge.ts";
import { BRIDGE_DEVELOPER_FEE_PERCENT } from "../fees/schedule.ts";

export type VirtualAccountDestinationConfig = {
  payment_rail: string;
  currency: string;
  address: string;
  bridge_wallet_id?: string | null;
  external_wallet_id?: string | null;
  source?: "bridge_wallet" | "external_wallet" | "static_config";
};

export type AffiliateOnrampFeeTier = {
  active_referrals: number;
  developer_fee_percent: string;
  tier_name: string;
  next_threshold: number | null;
  next_developer_fee_percent: string | null;
  dashboard_action_required: boolean;
};

const DEFAULT_VA_DEVELOPER_FEE_PERCENT = String(BRIDGE_DEVELOPER_FEE_PERCENT.virtual_account_fiat_individual);
const DEFAULT_BUSINESS_VA_DEVELOPER_FEE_PERCENT = String(BRIDGE_DEVELOPER_FEE_PERCENT.virtual_account_fiat_business);

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeFeePercent(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return String(Number(n.toFixed(4)));
}

async function readSetting(
  supa: { from: (table: string) => any },
  key: string,
): Promise<string | null> {
  for (const table of ["app_config", "app_settings"]) {
    try {
      const { data } = await supa
        .from(table)
        .select("value")
        .eq("key", key)
        .maybeSingle();
      const value = clean(data?.value);
      if (value) return value;
    } catch {
      // Try the next config table name; older environments used app_settings.
    }
  }
  return null;
}

export async function loadVirtualAccountDeveloperFeePercent(
  supa: { from: (table: string) => any; rpc?: any },
  accountType?: string | null,
  userId?: string | null,
): Promise<string> {
  const isBusiness = clean(accountType).toLowerCase() === "business";
  const configuredCandidates = [
    await readSetting(supa, isBusiness
      ? "bridge.virtual_account.onramp.business.developer_fee_percent"
      : "bridge.virtual_account.onramp.individual.developer_fee_percent"),
    await readSetting(supa, isBusiness
      ? "bridge.virtual_account.business.developer_fee_percent"
      : "bridge.virtual_account.individual.developer_fee_percent"),
    await readSetting(supa, "bridge.virtual_account.onramp.developer_fee_percent"),
    await readSetting(supa, "bridge.virtual_account.developer_fee_percent"),
    clean(Deno.env.get(isBusiness
      ? "BRIDGE_VA_ONRAMP_BUSINESS_DEVELOPER_FEE_PERCENT"
      : "BRIDGE_VA_ONRAMP_INDIVIDUAL_DEVELOPER_FEE_PERCENT")),
    clean(Deno.env.get("BRIDGE_VA_ONRAMP_DEVELOPER_FEE_PERCENT")),
    clean(Deno.env.get("BRIDGE_VA_DEVELOPER_FEE_PERCENT")),
  ];
  const configured = configuredCandidates.find(Boolean) || null;
  const baseFee = normalizeFeePercent(configured) ??
    (isBusiness ? DEFAULT_BUSINESS_VA_DEVELOPER_FEE_PERCENT : DEFAULT_VA_DEVELOPER_FEE_PERCENT);
  const tier = await loadAffiliateOnrampFeeTier(supa, userId);
  if (!tier) return baseFee;
  const base = Number(baseFee);
  const affiliate = Number(tier.developer_fee_percent);
  if (!Number.isFinite(base) || !Number.isFinite(affiliate)) return baseFee;
  return String(Number(Math.min(base, affiliate).toFixed(4)));
}

export async function loadAffiliateOnrampFeeTier(
  supa: { rpc?: any },
  userId?: string | null,
): Promise<AffiliateOnrampFeeTier | null> {
  const uid = clean(userId);
  if (!uid || typeof supa.rpc !== "function") return null;
  try {
    const { data, error } = await supa.rpc("get_affiliate_onramp_fee_tier", { p_user_id: uid });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data as Record<string, unknown> | null;
    if (!row || typeof row !== "object") return null;
    const fee = normalizeFeePercent((row as Record<string, unknown>).developer_fee_percent);
    const nextFeeRaw = (row as Record<string, unknown>).next_developer_fee_percent;
    const nextFee = nextFeeRaw === null || nextFeeRaw === undefined || Number(nextFeeRaw) === 0
      ? (Number(nextFeeRaw) === 0 ? "0" : null)
      : normalizeFeePercent(nextFeeRaw);
    if (fee === null && Number((row as Record<string, unknown>).developer_fee_percent) !== 0) return null;
    return {
      active_referrals: Number((row as Record<string, unknown>).active_referrals || 0),
      developer_fee_percent: fee ?? "0",
      tier_name: clean((row as Record<string, unknown>).tier_name) || "Starter",
      next_threshold: (row as Record<string, unknown>).next_threshold == null
        ? null
        : Number((row as Record<string, unknown>).next_threshold),
      next_developer_fee_percent: nextFee,
      dashboard_action_required: Boolean((row as Record<string, unknown>).dashboard_action_required),
    };
  } catch {
    return null;
  }
}

export async function loadVirtualAccountDestinationConfig(
  supa: { from: (table: string) => any },
  currency: VaCurrency,
  owner?: {
    userId?: string | null;
    bridgeCustomerId?: string | null;
  },
): Promise<VirtualAccountDestinationConfig> {
  const suffix = currency.toUpperCase();
  // One provider contract for USD, EUR and GBP: settle into the customer's
  // existing Bridge-owned USDC wallet on Base. Per-currency/static/external
  // destination overrides previously allowed USD to drift from EUR/GBP.
  const rail = "base";
  const ccy = "USDC";
  const userId = clean(owner?.userId);
  const bridgeCustomerId = clean(owner?.bridgeCustomerId);

  if (userId || bridgeCustomerId) {
    let query = supa
      .from("bridge_wallets")
      .select("bridge_wallet_id,address,currency,chain,status,updated_at")
      .ilike("currency", ccy)
      .ilike("chain", rail)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (bridgeCustomerId) query = query.eq("bridge_customer_id", bridgeCustomerId);
    if (userId) query = query.or(`user_id.eq.${userId},business_user_id.eq.${userId}`);

    const { data } = await query.maybeSingle();
    const walletAddress = clean(data?.address);
    const bridgeWalletId = clean(data?.bridge_wallet_id);
    if (walletAddress && bridgeWalletId) {
      return {
        payment_rail: rail,
        currency: ccy,
        address: walletAddress,
        bridge_wallet_id: bridgeWalletId,
        source: "bridge_wallet",
      };
    }

    if (bridgeCustomerId) {
      const bridgeWallets = await bridgeProvider.listWallets(bridgeCustomerId);
      const bridgeWallet = bridgeWallets.find((w) =>
        clean(w.currency).toUpperCase() === ccy &&
        clean(w.chain).toLowerCase() === rail &&
        clean(w.address) && clean(w.wallet_id)
      );
      if (bridgeWallet?.address) {
        try {
          await supa.from("bridge_wallets").upsert({
            user_id: userId || null,
            bridge_customer_id: bridgeCustomerId,
            bridge_wallet_id: clean(bridgeWallet.wallet_id),
            currency: ccy,
            chain: rail,
            address: clean(bridgeWallet.address),
            status: "active",
            updated_at: new Date().toISOString(),
          }, { onConflict: "bridge_wallet_id", ignoreDuplicates: false });
        } catch (e) {
          console.warn(`bridge wallet mirror failed during VA destination lookup: ${e instanceof Error ? e.message : String(e)}`);
        }
        return {
          payment_rail: rail,
          currency: ccy,
          address: clean(bridgeWallet.address),
          bridge_wallet_id: clean(bridgeWallet.wallet_id) || null,
          source: "bridge_wallet",
        };
      }
    }

    throw new Error(`Missing active Bridge ${ccy}/${rail} wallet for ${suffix} virtual account destination`);
  }
  throw new Error(`Missing Bridge customer owner for ${suffix} virtual account destination`);
}
