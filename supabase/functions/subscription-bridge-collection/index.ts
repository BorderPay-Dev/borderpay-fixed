import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { resolveBridgeScaScope } from "../_shared/bridge-sca-scope.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WORKER_TOKEN = Deno.env.get("WORKER_AUTH_TOKEN") ?? "";
const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function equal(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index++) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function decimalFromMinor(value: unknown): string {
  const minor = BigInt(clean(value));
  if (minor <= 0n) throw new Error("invalid_collection_amount");
  const units = minor / 1_000_000n;
  const fraction = (minor % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${units}.${fraction}` : units.toString();
}

function minorFromDecimal(value: unknown): string {
  const raw = clean(value);
  const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error("invalid_bridge_wallet_balance");
  const fraction = match[2] ?? "";
  if (fraction.length > 6 && /[1-9]/.test(fraction.slice(6))) {
    throw new Error("bridge_wallet_balance_precision_exceeded");
  }
  return (BigInt(match[1]) * 1_000_000n + BigInt((fraction.slice(0, 6) || "0").padEnd(6, "0"))).toString();
}

async function collect(subscriptionId: string, billingDate: string) {
  const { data: subscription, error: subscriptionError } = await db.from("subscriptions")
    .select("id,user_id,status,next_billing_date")
    .eq("id", subscriptionId)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;
  if (!subscription) throw new Error("subscription_not_found");

  // This endpoint is deliberately non-EEA only. An unavailable, ambiguous or
  // EEA identity never reaches Bridge money movement.
  const scope = await resolveBridgeScaScope(db, subscription.user_id);
  if (scope.status !== "not_required" || scope.reason !== "non_eea") {
    throw new Error(`bridge_subscription_collection_scope_blocked:${scope.reason}`);
  }

  const { data: wallets, error: walletError } = await db.from("bridge_wallets")
    .select("bridge_wallet_id,bridge_customer_id,currency,chain")
    .or(`user_id.eq.${subscription.user_id},business_user_id.eq.${subscription.user_id}`)
    .eq("status", "active")
    .in("currency", ["USDC", "USDT", "usdc", "usdt"]);
  if (walletError) throw walletError;
  const eligibleWallets = (wallets ?? []).filter((wallet) => {
    const asset = clean(wallet.currency).toUpperCase();
    const network = clean(wallet.chain).toUpperCase();
    return (asset === "USDC" && network === "BASE") || (asset === "USDT" && network === "TRON");
  });
  const providerBalances = await Promise.all(eligibleWallets.map(async (wallet) => {
    const balances = await bridgeProvider.getWalletBalances(wallet.bridge_customer_id, wallet.bridge_wallet_id);
    const asset = clean(wallet.currency).toUpperCase();
    const balance = balances.find((item) => clean(item.currency).toUpperCase() === asset)?.balance ?? "0";
    return { bridge_wallet_id: wallet.bridge_wallet_id, available_minor: minorFromDecimal(balance) };
  }));

  const { data: prepared, error: prepareError } = await db.rpc("prepare_bridge_subscription_collection", {
    p_subscription_id: subscriptionId,
    p_billing_date: billingDate,
    p_provider_balances: providerBalances,
  });
  if (prepareError) throw prepareError;
  if (!prepared || prepared.status === "skipped" || prepared.status === "failed") return prepared;

  const legs = Array.isArray(prepared.legs) ? prepared.legs : [];
  const outcomes: Array<Record<string, unknown>> = [];
  for (const leg of legs) {
    if (leg.provider_transfer_id || leg.status === "completed") {
      outcomes.push({ leg_id: leg.id, status: leg.status, provider_transfer_id: leg.provider_transfer_id, replay: true });
      continue;
    }
    try {
      const asset = clean(leg.asset).toUpperCase();
      const network = clean(leg.network).toUpperCase();
      if (!((asset === "USDC" && network === "BASE") || (asset === "USDT" && network === "TRON"))) {
        throw new Error("unsupported_subscription_collection_route");
      }
      const idempotencyKey = `subscription-maintenance:${prepared.collection_id}:${leg.id}`;
      const result = await bridgeProvider.createTransfer({
        on_behalf_of: clean(leg.bridge_customer_id),
        source: {
          payment_rail: "bridge_wallet",
          currency: asset as "USDC" | "USDT",
          bridge_wallet_id: clean(leg.source_bridge_wallet_id),
          amount: decimalFromMinor(leg.amount_minor),
        },
        destination: {
          payment_rail: network === "BASE" ? "base" : "tron",
          currency: asset as "USDC" | "USDT",
          address: clean(leg.destination_address),
        },
        // Maintenance is BorderPay revenue; charging a developer fee on this
        // treasury sweep would double-charge the customer.
        developer_fee: undefined,
        idempotency_key: idempotencyKey,
      });
      if (!clean(result.transfer_id)) throw new Error("bridge_transfer_id_missing");
      const { error: recordError } = await db.rpc("record_bridge_subscription_collection_submission", {
        p_leg_id: leg.id,
        p_provider_transfer_id: result.transfer_id,
        p_provider_state: result.state,
        p_error: null,
      });
      if (recordError) throw recordError;
      outcomes.push({ leg_id: leg.id, status: "submitted", provider_transfer_id: result.transfer_id });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await db.rpc("record_bridge_subscription_collection_submission", {
        p_leg_id: leg.id,
        p_provider_transfer_id: null,
        p_provider_state: null,
        p_error: message,
      });
      outcomes.push({ leg_id: leg.id, status: "submit_failed", error: message.slice(0, 300) });
    }
  }
  return { collection_id: prepared.collection_id, status: "submitted", outcomes };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  try {
    const token = clean(req.headers.get("Authorization")).replace(/^Bearer\s+/i, "");
    const { data: configuredWorkerToken } = await db.rpc("app_config_get", { p_key: "worker_auth_token" });
    if (!(equal(token, WORKER_TOKEN) || equal(token, SERVICE_ROLE) || equal(token, clean(configuredWorkerToken)))) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
    const body = await req.json().catch(() => ({}));
    const subscriptionId = clean(body?.subscription_id);
    const billingDate = clean(body?.billing_date) || new Date().toISOString().slice(0, 10);
    if (!/^[0-9a-f-]{36}$/i.test(subscriptionId) || !/^\d{4}-\d{2}-\d{2}$/.test(billingDate)) {
      return json({ success: false, error: "invalid_request" }, 400);
    }
    return json({ success: true, data: await collect(subscriptionId, billingDate) });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error("subscription_bridge_collection_failed", { error: message });
    const blocked = message.startsWith("bridge_subscription_collection_scope_blocked:");
    return json({ success: false, error: message.slice(0, 500) }, blocked ? 409 : 500);
  }
});
