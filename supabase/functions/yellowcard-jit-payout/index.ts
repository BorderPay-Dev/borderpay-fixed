import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateVerifiedAfricanRailsUser } from "../_shared/african-rails-access.ts";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";
import { consumeScaAuthorization } from "../_shared/sca.ts";
import { calculateYellowCardJitDebit } from "../_shared/providers/yellowcard-jit.ts";
import { loadYellowCardCanonicalSender } from "../_shared/providers/yellowcard-customer.ts";
import {
  calculateYellowCardCustomerFee,
  findYellowCardCommercialRail,
} from "../_shared/providers/yellowcard-commercial-policy.ts";
import { getYellowCardConfig, yellowCardFetch } from "../_shared/providers/yellowcard-client.ts";
import { resolveYellowCardRouting } from "../_shared/providers/yellowcard-routing.ts";
import { encryptYellowCardRecipient } from "../_shared/yellowcard-recipient-security.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const flag = (name: string) => ["1", "true", "yes", "on", "enabled"].includes(
  String(Deno.env.get(name) || "").trim().toLowerCase(),
);
const text = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => text(value).toUpperCase();
const lower = (value: unknown) => text(value).toLowerCase();

function publicPayout(row: any) {
  return {
    id: row.id,
    sequence_id: row.sequence_id,
    state: row.state,
    settlement_asset: row.settlement_asset,
    settlement_amount: row.settlement_amount,
    borderpay_fee_amount: row.borderpay_fee_amount,
    customer_debit_amount: row.customer_debit_amount,
    destination_country: row.destination_country,
    destination_currency: row.destination_currency,
    destination_amount: row.destination_amount,
    channel: row.channel,
    provider_status: row.provider_status,
    sla_started_at: row.sla_started_at,
    sla_due_at: row.sla_due_at,
    completed_at: row.completed_at,
    failed_at: row.failed_at,
    refund_pending: row.state === "REFUND_PENDING",
    failure_code: row.failure_code,
    created_at: row.created_at,
  };
}

async function liveRouting(input: {
  country: string;
  currency: string;
  channel: "bank" | "mobile_money";
  localAmount: number;
  networkId: string;
}) {
  const [channels, networks] = await Promise.all([
    yellowCardFetch({ method: "GET", path: "/channels", query: { country: input.country } }),
    yellowCardFetch({ method: "GET", path: "/networks", query: { country: input.country } }),
  ]);
  if (!channels.ok || !networks.ok) throw new Error("yellow_card_live_routing_unavailable");
  return resolveYellowCardRouting({
    channels: channels.data,
    networks: networks.data,
    direction: "payout",
    country: input.country,
    currency: input.currency,
    rail: input.channel,
    networkId: input.networkId,
    amount: input.localAmount,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, code: "method_not_allowed" }, 405);
  const access = await authenticateVerifiedAfricanRailsUser(supabase, req);
  if (!access.allowed) return json({ success: false, code: access.code, error: access.message }, access.status);

  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, code: "invalid_json" }, 400); }
  const action = lower(body?.action || "preflight");
  if (action === "status") {
    const payoutId = text(body?.payout_id);
    const { data } = await supabase.from("yellowcard_jit_payouts").select("*")
      .eq("id", payoutId).eq("user_id", access.user.id).maybeSingle();
    return data ? json({ success: true, data: { payout: publicPayout(data) } }) : json({ success: false, code: "payout_not_found" }, 404);
  }

  const config = getYellowCardConfig();
  if (!config.configured || config.environment !== "production" || !config.production_host_pinned) {
    return json({ success: false, code: "yellow_card_production_unavailable" }, 503);
  }
  const country = upper(body?.country);
  const currency = upper(body?.currency);
  const channel = lower(body?.channel) as "bank" | "mobile_money";
  const localAmount = Number(body?.local_amount);
  const settlementAsset = upper(body?.settlement_asset) as "USDC" | "USDT";
  const settlementNetwork = upper(body?.settlement_network) as "BASE" | "TRON";
  const settlementAmount = text(body?.settlement_amount);
  const bridgeWalletId = text(body?.bridge_wallet_id);
  const networkId = text(body?.network_id);
  const supportedSettlement =
    (settlementAsset === "USDC" && settlementNetwork === "BASE") ||
    (settlementAsset === "USDT" && settlementNetwork === "TRON");
  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z]{3}$/.test(currency) ||
      !["bank", "mobile_money"].includes(channel) || !Number.isInteger(localAmount) || localAmount <= 0 ||
      !supportedSettlement || !bridgeWalletId || !networkId) {
    return json({ success: false, code: "yellow_card_invalid_payout_request" }, 400);
  }
  let amounts;
  try { amounts = calculateYellowCardJitDebit(settlementAmount); }
  catch (error) { return json({ success: false, code: (error as Error).message }, 400); }

  const commercialRail = findYellowCardCommercialRail({
    direction: "payout", countryCode: country, currency, channel,
  });
  const commercialFee = commercialRail ? calculateYellowCardCustomerFee(commercialRail, localAmount) : null;
  if (!commercialRail || !commercialFee) return json({ success: false, code: "yellow_card_commercial_corridor_unavailable" }, 403);
  let routing;
  try { routing = await liveRouting({ country, currency, channel, localAmount, networkId }); }
  catch { return json({ success: false, code: "yellow_card_live_routing_unavailable" }, 502); }
  if (!routing.selectedChannel || !routing.selectedNetwork) {
    return json({ success: false, code: "yellow_card_live_route_unavailable" }, 409);
  }

  const preflight = {
    country,
    currency,
    channel,
    local_amount: localAmount,
    settlement_asset: settlementAsset,
    settlement_network: settlementNetwork,
    settlement_amount: amounts.settlementAmount,
    borderpay_fee_amount: amounts.borderpayFeeAmount,
    customer_debit_amount: amounts.customerDebitAmount,
    provider_fee_amount_local: commercialFee.provider_amount_local,
    provider_fee_currency: currency,
    network_id: text(routing.selectedNetwork.id),
    route_source: "yellow_card_live_channels_and_networks",
  };
  if (action === "preflight") return json({ success: true, data: { preflight } });
  if (action !== "create") return json({ success: false, code: "unsupported_action" }, 400);
  if (!flag("YC_PRODUCTION_SEND_ENABLED") || !flag("YC_JIT_PAYOUT_ENABLED")) {
    return json({ success: false, code: "yellow_card_jit_payout_disabled" }, 503);
  }

  const idempotencyKey = text(req.headers.get("Idempotency-Key") || body?.idempotency_key);
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return json({ success: false, code: "idempotency_key_required" }, 400);
  }
  const { data: existing } = await supabase.from("yellowcard_jit_payouts").select("*")
    .eq("user_id", access.user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing) return json({ success: true, code: "idempotent_replay", data: { payout: publicPayout(existing) } });

  const identity = await loadAndAssertBridgeIdentityInvariant(supabase, access.user.id);
  if (!identity.ok || !identity.context.bridge_customer_id) {
    return json({ success: false, code: "yellow_card_identity_unavailable" }, 409);
  }
  const { data: wallet } = await supabase.from("bridge_wallets")
    .select("bridge_wallet_id,address,status,currency,chain")
    .eq("bridge_wallet_id", bridgeWalletId)
    .or(`user_id.eq.${access.user.id},business_user_id.eq.${access.user.id}`)
    .maybeSingle();
  if (!wallet || lower(wallet.status) !== "active" || upper(wallet.currency) !== settlementAsset || upper(wallet.chain) !== settlementNetwork) {
    return json({ success: false, code: "active_owned_settlement_wallet_required" }, 409);
  }

  const sca = await consumeScaAuthorization({
    supabase,
    authorizationId: body?.sca_authorization_id,
    userId: access.user.id,
    operation: "payment",
    resource: "yellowcard_jit_payout",
    request: body,
  });
  if (!sca.ok) return json(sca.body, sca.status);

  const recipient = {
    accountName: text(body?.recipient?.account_name),
    accountNumber: text(body?.recipient?.account_number),
    accountType: channel === "mobile_money" ? "momo" : "bank",
    networkId: text(routing.selectedNetwork.id),
  };
  if (!recipient.accountName || !recipient.accountNumber) {
    return json({ success: false, code: "yellow_card_recipient_incomplete" }, 400);
  }
  let sender;
  try {
    sender = await loadYellowCardCanonicalSender(supabase, {
      userId: access.user.id,
      bridgeCustomerId: identity.context.bridge_customer_id,
      accountType: identity.context.account_type,
    });
  } catch (error) {
    return json({ success: false, code: (error as Error).message }, 409);
  }

  const sequenceId = crypto.randomUUID();
  const encryptionKey = text(Deno.env.get("YC_RECIPIENT_ENCRYPTION_KEY"));
  const keyVersion = text(Deno.env.get("YC_RECIPIENT_ENCRYPTION_KEY_VERSION") || "1");
  if (!encryptionKey) return json({ success: false, code: "yellow_card_recipient_encryption_unavailable" }, 503);
  let ciphertext;
  try {
    ciphertext = await encryptYellowCardRecipient({
      sender,
      recipient,
      reason: lower(body?.reason || "other"),
    }, sequenceId, keyVersion, encryptionKey);
  } catch {
    return json({ success: false, code: "yellow_card_recipient_encryption_failed" }, 503);
  }

  const { data: reserved, error: reserveError } = await supabase.rpc("reserve_yellowcard_jit_payout", {
    p_user_id: access.user.id,
    p_idempotency_key: idempotencyKey,
    p_sequence_id: sequenceId,
    p_bridge_wallet_id: bridgeWalletId,
    p_settlement_asset: settlementAsset,
    p_settlement_network: settlementNetwork,
    p_settlement_amount: amounts.settlementAmount,
    p_destination_country: country,
    p_destination_currency: currency,
    p_destination_amount: localAmount,
    p_channel: channel,
    p_provider_fee_amount_local: commercialFee.provider_amount_local,
    p_recipient_ciphertext: ciphertext,
    p_recipient_key_version: keyVersion,
    p_metadata: {
      bridge_customer_id: identity.context.bridge_customer_id,
      account_type: identity.context.account_type,
      refund_address: wallet.address,
      provider_network_id: text(routing.selectedNetwork.id),
      provider_channel_id: text(routing.selectedChannel.id),
      provider_fee_snapshot: commercialFee,
      borderpay_fee_percent: 2,
      sca_applied: sca.required,
    },
  });
  if (reserveError) {
    const insufficient = reserveError.message.includes("insufficient unreserved wallet balance");
    return json({ success: false, code: insufficient ? "insufficient_balance" : "yellow_card_reservation_failed" }, insufficient ? 402 : 409);
  }
  const payoutId = text(reserved?.payout_id);
  const { data: payout } = await supabase.from("yellowcard_jit_payouts").select("*").eq("id", payoutId).single();
  return json({ success: true, data: { payout: publicPayout(payout) } }, 202);
});
