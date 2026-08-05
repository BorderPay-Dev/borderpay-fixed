import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateAfricanRailsTester, recordAfricanRailsOperatorAlert } from "../_shared/african-rails-access.ts";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { isBridgeProfileVerified } from "../_shared/providers/provider-corridor-policy.ts";
import { findYellowCardCommercialRail, normalizeYellowCardCountryCode } from "../_shared/providers/yellowcard-commercial-policy.ts";
import { getYellowCardConfig, yellowCardFetch } from "../_shared/providers/yellowcard-client.ts";
import {
  buildYellowCardSandboxReceivePayload,
  redactYellowCardReceivePayload,
  type YellowCardRetailKyc,
  type YellowCardSettlement,
} from "../_shared/providers/yellowcard-payload.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const flag = (name: string, fallback = false) => {
  const value = String(Deno.env.get(name) ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(value);
};

const str = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => str(value).toUpperCase();
const lower = (value: unknown) => str(value).toLowerCase();

// Yellow Card sandbox outcome controls. Never send a customer's real Bridge
// wallet address or phone number to the sandbox transaction simulator.
const SANDBOX_SUCCESS_EVM_ADDRESS = "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe";
const SANDBOX_SUCCESS_TRON_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const COUNTRY_DIAL_CODES: Record<string, string> = {
  BW: "267", CM: "237", CD: "243", CG: "242", CI: "225", GA: "241",
  GH: "233", KE: "254", MW: "265", NG: "234", RW: "250", SN: "221",
  TZ: "255", UG: "256", ZA: "27", ZM: "260",
};

function sandboxSuccessAccount(country: string, channel: string): string {
  if (channel !== "mobile_money") return "1111111111";
  const dialCode = COUNTRY_DIAL_CODES[country];
  if (!dialCode) throw new Error("yellow_card_missing_sandbox_dial_code");
  return `+${dialCode}1111111111`;
}

function rowsFrom(value: any, key: string): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function isActive(value: any): boolean {
  return ["active", "enabled", "available"].includes(lower(value));
}

function receiveRamp(value: any): boolean {
  return ["deposit", "receive", "collection", "payin", "pay-in", "onramp", "on-ramp"].includes(lower(value));
}

function railToYc(channel: string): "bank" | "momo" {
  return channel === "mobile_money" ? "momo" : "bank";
}

function ycToPolicyRail(channel: unknown): "bank" | "mobile_money" | null {
  const value = lower(channel);
  if (value === "bank") return "bank";
  if (["momo", "mobile_money", "mobilemoney"].includes(value)) return "mobile_money";
  return null;
}

function formatDob(value: unknown): string {
  const raw = str(value);
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  const us = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return us ? raw : "";
}

function profileAddress(profile: any, bridgeIdentity: any): string {
  const local = [profile?.address, profile?.city, profile?.state, profile?.postal_code]
    .map(str)
    .filter(Boolean)
    .join(", ");
  if (local) return local;
  const address = bridgeIdentity?.address_object;
  return [address?.street_line_1, address?.street_line_2, address?.city, address?.state, address?.postal_code]
    .map(str)
    .filter(Boolean)
    .join(", ");
}

function channelMatches(channel: any, input: { country: string; currency: string; rail: string }): boolean {
  return upper(channel?.country) === input.country &&
    upper(channel?.currency || channel?.countryCurrency) === input.currency &&
    ycToPolicyRail(channel?.channelType) === input.rail &&
    receiveRamp(channel?.rampType) &&
    isActive(channel?.apiStatus || channel?.status);
}

function networkMatches(network: any, input: { country: string; channelId: string; accountType: string }): boolean {
  const channelIds = Array.isArray(network?.channelIds) ? network.channelIds.map(str) : [];
  const accountType = lower(network?.accountNumberType);
  return upper(network?.country) === input.country &&
    isActive(network?.status) &&
    channelIds.includes(input.channelId) &&
    (!accountType || accountType === input.accountType);
}

function publicTransaction(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    sequence_id: row.sequence_id,
    provider_transaction_id: row.provider_transaction_id,
    provider_reference: row.provider_reference,
    deposit_id: row.deposit_id,
    direction: row.direction,
    country_code: row.country_code,
    currency: row.currency,
    channel: row.channel,
    local_amount: row.local_amount,
    usd_amount: row.usd_amount,
    converted_amount: row.converted_amount,
    settlement_currency: row.settlement_currency,
    settlement_network: row.settlement_network,
    status: row.status,
    provider_status: row.provider_status,
    service_fee_local: row.service_fee_local,
    service_fee_usd: row.service_fee_usd,
    network_fee_local: row.network_fee_local,
    network_fee_usd: row.network_fee_usd,
    partner_fee_local: row.partner_fee_local,
    partner_fee_usd: row.partner_fee_usd,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function providerFields(payload: any) {
  return {
    provider_transaction_id: str(payload?.id) || null,
    provider_reference: str(payload?.reference) || null,
    deposit_id: str(payload?.depositId) || null,
    provider_status: lower(payload?.status) || null,
    status: lower(payload?.status) || "submitted",
    usd_amount: Number.isFinite(Number(payload?.amount)) ? Number(payload.amount) : null,
    converted_amount: Number.isFinite(Number(payload?.convertedAmount)) ? Number(payload.convertedAmount) : null,
    service_fee_local: Number.isFinite(Number(payload?.serviceFeeAmountLocal)) ? Number(payload.serviceFeeAmountLocal) : null,
    service_fee_usd: Number.isFinite(Number(payload?.serviceFeeAmountUSD)) ? Number(payload.serviceFeeAmountUSD) : null,
    network_fee_local: Number.isFinite(Number(payload?.networkFeeAmountLocal)) ? Number(payload.networkFeeAmountLocal) : null,
    network_fee_usd: Number.isFinite(Number(payload?.networkFeeAmountUSD)) ? Number(payload.networkFeeAmountUSD) : null,
    partner_fee_local: Number.isFinite(Number(payload?.partnerFeeAmountLocal)) ? Number(payload.partnerFeeAmountLocal) : null,
    partner_fee_usd: Number.isFinite(Number(payload?.partnerFeeAmountUSD)) ? Number(payload.partnerFeeAmountUSD) : null,
    provider_response: payload && typeof payload === "object" ? payload : {},
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function loadContext(userId: string, input: any) {
  const country = upper(input?.country);
  const currency = upper(input?.currency);
  const channel = lower(input?.channel);
  const localAmount = Number(input?.local_amount);
  const settlementCurrency = upper(input?.settlement_currency);
  const settlementNetwork = upper(input?.settlement_network);

  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z]{3}$/.test(currency)) {
    return { ok: false as const, status: 400, code: "yellow_card_invalid_corridor" };
  }
  if (!["bank", "mobile_money"].includes(channel)) {
    return { ok: false as const, status: 400, code: "yellow_card_invalid_channel" };
  }
  if (!Number.isFinite(localAmount) || !Number.isInteger(localAmount) || localAmount <= 0) {
    return { ok: false as const, status: 400, code: "yellow_card_invalid_local_amount" };
  }
  const settlementAllowed =
    (settlementCurrency === "USDC" && settlementNetwork === "BASE") ||
    (settlementCurrency === "USDT" && ["TRON", "TRC20"].includes(settlementNetwork));
  if (!settlementAllowed) {
    return { ok: false as const, status: 400, code: "yellow_card_unsupported_settlement_route" };
  }

  const { data: profile, error: profileError } = await supa
    .from("user_profiles")
    .select("id,email,full_name,phone,country,address,city,state,postal_code,date_of_birth,id_number,id_type,account_type,bridge_customer_id,bridge_kyc_status,bridge_account_status")
    .eq("id", userId)
    .maybeSingle();
  if (profileError || !profile) return { ok: false as const, status: 404, code: "profile_not_found" };
  if (["paused", "frozen", "disabled", "deactivated"].includes(lower(profile.bridge_account_status))) {
    return { ok: false as const, status: 403, code: "account_restricted" };
  }
  if (!isBridgeProfileVerified(profile)) {
    return { ok: false as const, status: 403, code: "bridge_verification_required" };
  }

  const profileCountry = normalizeYellowCardCountryCode(profile.country);
  if (profileCountry !== country) {
    return { ok: false as const, status: 403, code: "receive_country_must_match_account_country" };
  }

  const commercialRail = findYellowCardCommercialRail({
    direction: "receive",
    countryCode: country,
    currency,
    channel: channel as "bank" | "mobile_money",
  });
  if (!commercialRail) {
    return { ok: false as const, status: 403, code: "yellow_card_commercial_corridor_unavailable" };
  }

  const policy = { enabled: true, code: "ok" as const, row: commercialRail };

  let bridgeIdentity: any = null;
  if (profile.bridge_customer_id && (!profile.id_number || !profile.id_type || !profile.date_of_birth || !profile.address)) {
    try {
      bridgeIdentity = await bridgeProvider.getCustomerProfile(profile.bridge_customer_id);
    } catch {
      bridgeIdentity = null;
    }
  }

  const kyc: YellowCardRetailKyc = {
    name: str(profile.full_name),
    country: upper(profile.country || bridgeIdentity?.country),
    phone: str(profile.phone || bridgeIdentity?.phone),
    address: profileAddress(profile, bridgeIdentity),
    dob: formatDob(profile.date_of_birth || bridgeIdentity?.date_of_birth),
    email: lower(profile.email),
    idNumber: str(profile.id_number || bridgeIdentity?.id_number),
    idType: str(profile.id_type || bridgeIdentity?.id_type),
  };
  const missingKyc = Object.entries(kyc).filter(([, value]) => !value).map(([key]) => key);

  const bridgeChain = settlementCurrency === "USDC" ? "base" : "tron";
  const { data: wallet } = await supa
    .from("bridge_wallets")
    .select("bridge_wallet_id,address,currency,chain,status")
    .eq("user_id", userId)
    .ilike("currency", settlementCurrency)
    .ilike("chain", bridgeChain)
    .eq("status", "active")
    .maybeSingle();
  if (!wallet?.address) {
    return { ok: false as const, status: 409, code: "bridge_settlement_wallet_required" };
  }

  const channelsResult = await yellowCardFetch({ method: "GET", path: "/channels", query: { country } });
  if (!channelsResult.ok) {
    return { ok: false as const, status: 502, code: channelsResult.error || "yellow_card_channels_failed" };
  }
  const channels = rowsFrom(channelsResult.data, "channels").filter((candidate) =>
    channelMatches(candidate, { country, currency, rail: channel })
  );

  const selectedChannelId = str(input?.channel_id);
  const selectedChannel = selectedChannelId
    ? channels.find((candidate) => str(candidate?.id) === selectedChannelId)
    : (channels.length === 1 ? channels[0] : null);

  if (selectedChannel) {
    const minimum = Number(selectedChannel?.min);
    const maximum = Number(selectedChannel?.max);
    if ((Number.isFinite(minimum) && localAmount < minimum) ||
      (Number.isFinite(maximum) && maximum > 0 && localAmount > maximum)) {
      return { ok: false as const, status: 422, code: "yellow_card_amount_outside_provider_limits" };
    }
  }

  let networks: any[] = [];
  let selectedNetwork: any = null;
  if (selectedChannel) {
    const networksResult = await yellowCardFetch({ method: "GET", path: "/networks", query: { country } });
    if (!networksResult.ok) {
      return { ok: false as const, status: 502, code: networksResult.error || "yellow_card_networks_failed" };
    }
    const ycAccountType = railToYc(channel);
    networks = rowsFrom(networksResult.data, "networks").filter((candidate) =>
      networkMatches(candidate, { country, channelId: str(selectedChannel?.id), accountType: ycAccountType })
    );
    const selectedNetworkId = str(input?.network_id);
    selectedNetwork = selectedNetworkId
      ? networks.find((candidate) => str(candidate?.id) === selectedNetworkId)
      : (networks.length === 1 ? networks[0] : null);
  }

  const settlementInfo: YellowCardSettlement = settlementCurrency === "USDC"
    ? { cryptoCurrency: "USDC", cryptoNetwork: "BASE", walletAddress: SANDBOX_SUCCESS_EVM_ADDRESS }
    : { cryptoCurrency: "USDT", cryptoNetwork: "TRC20", walletAddress: SANDBOX_SUCCESS_TRON_ADDRESS };

  return {
    ok: true as const,
    country,
    currency,
    channel,
    localAmount,
    policy: policy.row,
    profile,
    kyc,
    missingKyc,
    wallet,
    settlementInfo,
    channels,
    selectedChannel,
    networks,
    selectedNetwork,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const access = await authenticateAfricanRailsTester(supa, req);
  if (!access.allowed) return json({ success: false, code: access.code, error: access.message }, access.status);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, code: "invalid_json", error: "Invalid JSON body" }, 400);
  }

  const config = getYellowCardConfig();
  if (!config.configured || config.environment !== "sandbox") {
    await recordAfricanRailsOperatorAlert(supa, {
      userId: access.user.id,
      endpoint: "yellowcard-sandbox-transaction",
      code: "yellow_card_sandbox_unavailable",
      message: "Yellow Card sandbox transaction adapter is unavailable or not in sandbox mode.",
    });
    return json({ success: false, code: "yellow_card_sandbox_unavailable", error: "This test route is unavailable." }, 503);
  }
  if (flag("YC_LIVE_ROUTING_ENABLED")) {
    return json({ success: false, code: "yellow_card_live_routing_blocked", error: "This function is sandbox-only." }, 403);
  }
  if (!flag("YC_SANDBOX_INTERNAL_ONLY", true)) {
    return json({ success: false, code: "yellow_card_sandbox_gate_misconfigured", error: "This test route is unavailable." }, 503);
  }

  const action = lower(body?.action || "preflight");
  if (action === "status") {
    const sequenceId = str(body?.sequence_id);
    if (!sequenceId) return json({ success: false, code: "sequence_id_required" }, 400);
    const { data: existing } = await supa
      .from("yellowcard_transactions")
      .select("*")
      .eq("user_id", access.user.id)
      .eq("environment", "sandbox")
      .eq("sequence_id", sequenceId)
      .maybeSingle();
    if (!existing) return json({ success: false, code: "yellow_card_transaction_not_found" }, 404);
    const provider = await yellowCardFetch({
      method: "GET",
      path: `/receive/sequence-id/${encodeURIComponent(sequenceId)}`,
    });
    if (!provider.ok) {
      return json({ success: false, code: provider.error || "yellow_card_status_failed", data: { transaction: publicTransaction(existing) } }, 502);
    }
    const updates = providerFields(provider.data);
    const { data: updated } = await supa
      .from("yellowcard_transactions")
      .update(updates)
      .eq("id", existing.id)
      .select("*")
      .single();
    return json({ success: true, data: { transaction: publicTransaction(updated || { ...existing, ...updates }) } });
  }

  const context = await loadContext(access.user.id, body);
  if (!context.ok) return json({ success: false, code: context.code, error: "Yellow Card preflight failed." }, context.status);

  const preflight = {
    corridor_allowed: true,
    country: context.country,
    currency: context.currency,
    channel: context.channel,
    local_amount: context.localAmount,
    transaction_fee: {
      percent: context.policy?.provider_fee_percent ?? null,
      usd: null,
      local: context.policy?.provider_fee_local ?? null,
      minimum_local: context.policy?.minimum_fee_local ?? null,
      maximum_local: context.policy?.maximum_fee_local ?? null,
      source: context.policy?.source_document ?? null,
    },
    kyc_complete: context.missingKyc.length === 0,
    missing_kyc_fields: context.missingKyc,
    bridge_settlement_wallet_ready: true,
    sandbox_simulated: true,
    sandbox_expected_outcome: "success",
    settlement_currency: context.settlementInfo.cryptoCurrency,
    settlement_network: context.settlementInfo.cryptoNetwork,
    channel_candidates: context.channels.map((row) => ({
      id: str(row?.id),
      type: lower(row?.channelType),
      ramp_type: lower(row?.rampType),
      minimum: row?.min ?? null,
      maximum: row?.max ?? null,
      fee_usd: row?.feeUSD ?? null,
      fee_local: row?.feeLocal ?? null,
    })),
    selected_channel_id: str(context.selectedChannel?.id) || null,
    network_candidates: context.networks.map((row) => ({
      id: str(row?.id),
      name: str(row?.name),
      code: str(row?.code),
      account_type: lower(row?.accountNumberType),
    })),
    selected_network_id: str(context.selectedNetwork?.id) || null,
    can_create: context.missingKyc.length === 0 && Boolean(context.selectedChannel) &&
      (context.channel === "bank" || Boolean(context.selectedNetwork)),
  };
  if (action === "preflight") return json({ success: true, data: preflight });
  if (action !== "create_receive") return json({ success: false, code: "unsupported_action" }, 400);

  if (!flag("YC_ENABLED") || !flag("YC_MONEY_MOVEMENT_ENABLED")) {
    return json({ success: false, code: "yellow_card_money_movement_disabled", error: "This test route is unavailable." }, 503);
  }
  if (body?.operator_confirmed !== true) {
    return json({ success: false, code: "operator_confirmation_required", data: { preflight } }, 409);
  }
  if (!preflight.can_create) {
    return json({ success: false, code: "yellow_card_preflight_incomplete", data: { preflight } }, 409);
  }

  const sequenceId = str(body?.sequence_id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sequenceId)) {
    return json({ success: false, code: "yellow_card_invalid_sequence_id" }, 400);
  }
  const { data: prior } = await supa
    .from("yellowcard_transactions")
    .select("*")
    .eq("environment", "sandbox")
    .eq("sequence_id", sequenceId)
    .maybeSingle();
  if (prior) {
    return json({
      success: Boolean(prior.provider_transaction_id),
      code: prior.provider_transaction_id ? "idempotent_replay" : "yellow_card_reconciliation_required",
      data: { transaction: publicTransaction(prior) },
    }, prior.provider_transaction_id ? 200 : 409);
  }

  let providerBody: Record<string, unknown>;
  try {
    providerBody = buildYellowCardSandboxReceivePayload({
      sequenceId,
      channelId: str(context.selectedChannel.id),
      localAmount: context.localAmount,
      country: context.country,
      currency: context.currency,
      reason: str(body?.reason),
      customerUID: access.user.id,
      recipient: context.kyc,
      source: {
        accountType: railToYc(context.channel),
        accountNumber: sandboxSuccessAccount(context.country, context.channel),
        ...(context.selectedNetwork?.id ? { networkId: str(context.selectedNetwork.id) } : {}),
      },
      settlementInfo: context.settlementInfo,
    });
  } catch (error) {
    return json({ success: false, code: error instanceof Error ? error.message : "yellow_card_payload_invalid" }, 400);
  }

  const { data: inserted, error: insertError } = await supa
    .from("yellowcard_transactions")
    .insert({
      user_id: access.user.id,
      environment: "sandbox",
      direction: "receive",
      sequence_id: sequenceId,
      country_code: context.country,
      currency: context.currency,
      channel: context.channel,
      provider_channel_id: str(context.selectedChannel.id),
      provider_network_id: str(context.selectedNetwork?.id) || null,
      local_amount: context.localAmount,
      settlement_currency: context.settlementInfo.cryptoCurrency,
      settlement_network: context.settlementInfo.cryptoNetwork,
      status: "submitted",
      request_payload: redactYellowCardReceivePayload(providerBody),
      metadata: {
        tester_only: true,
        operator_confirmed: true,
        source: "yellow_card_sandbox",
        sandbox_simulated: true,
        expected_outcome: "success",
      },
    })
    .select("*")
    .single();
  if (insertError || !inserted) {
    return json({ success: false, code: "yellow_card_persistence_failed", error: "The test transaction was not sent." }, 500);
  }

  const provider = await yellowCardFetch({ method: "POST", path: "/receive", body: providerBody });
  if (!provider.ok) {
    const updates = {
      status: "failed",
      provider_status: "rejected",
      provider_response: provider.data && typeof provider.data === "object" ? provider.data : {},
      last_error: provider.error || "yellow_card_receive_failed",
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await supa.from("yellowcard_transactions").update(updates).eq("id", inserted.id);
    return json({
      success: false,
      code: provider.error || "yellow_card_receive_failed",
      error: "The Yellow Card sandbox request was rejected.",
      data: { transaction: publicTransaction({ ...inserted, ...updates }) },
    }, provider.status >= 400 && provider.status < 500 ? 422 : 502);
  }

  const updates = providerFields(provider.data);
  const { data: updated } = await supa
    .from("yellowcard_transactions")
    .update(updates)
    .eq("id", inserted.id)
    .select("*")
    .single();
  return json({ success: true, data: { transaction: publicTransaction(updated || { ...inserted, ...updates }) } }, 201);
});
