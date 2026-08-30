import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  authenticateVerifiedAfricanRailsUser,
  recordAfricanRailsOperatorAlert,
} from "../_shared/african-rails-access.ts";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { extractBridgeWebhookIdentity } from "../_shared/providers/bridge-webhook-identity.ts";
import { isBridgeProfileVerified } from "../_shared/providers/provider-corridor-policy.ts";
import { calculateYellowCardCustomerFee, findYellowCardCommercialRail, normalizeYellowCardCountryCode } from "../_shared/providers/yellowcard-commercial-policy.ts";
import { getYellowCardConfig, yellowCardFetch } from "../_shared/providers/yellowcard-client.ts";
import {
  resolveYellowCardRouting,
} from "../_shared/providers/yellowcard-routing.ts";
import { africanRailMarkupPercentForAccount } from "../_shared/fees/schedule.ts";
import {
  buildYellowCardDirectSettlementReceivePayload,
  redactYellowCardReceivePayload,
  yellowCardReducedKycEligible,
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
const APP_URL = String(Deno.env.get("APP_URL") || "https://app.borderpayafrica.com").replace(/\/+$/, "");
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

async function yellowCardReadWithRetry(options: Parameters<typeof yellowCardFetch>[0]) {
  let result = await yellowCardFetch(options);
  for (let attempt = 0; !result.ok && attempt < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    result = await yellowCardFetch(options);
  }
  return result;
}

function yellowCardPayloadAccountType(channel: string): "bank" | "momo" {
  // The transaction API uses the rail account type while /networks describes
  // the required account-number shape (`phone` for MoMo).
  return channel === "mobile_money" ? "momo" : "bank";
}

function formatDob(value: unknown): string {
  const raw = str(value);
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  const us = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return us ? raw : "";
}

function yellowCardBuyRate(payload: any, currency: string): number | null {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.rates)
      ? payload.rates
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.data?.rates)
          ? payload.data.rates
          : [];
  const row = rows.find((item: any) => upper(item?.code || item?.currency) === currency);
  const rate = Number(row?.buy);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function profileAddress(profile: any, bridgeIdentity: any, webhookIdentity: any): string {
  if (webhookIdentity?.address) return str(webhookIdentity.address);
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

async function loadSignedBridgeIdentityEvidence(bridgeCustomerId: string) {
  const common = () => supa
    .from("bridge_webhook_events")
    .select("event_id,event_type,payload,received_at")
    .eq("signature_ok", true)
    .eq("processing_status", "completed")
    .order("received_at", { ascending: false })
    .limit(5);
  const [customerEvents, kycEvents] = await Promise.all([
    common().like("event_type", "customer.%").contains("payload", { event_object: { id: bridgeCustomerId } }),
    common().like("event_type", "kyc_link.%").contains("payload", { event_object: { customer_id: bridgeCustomerId } }),
  ]);
  if (customerEvents.error || kycEvents.error) {
    throw new Error("bridge_identity_evidence_lookup_failed");
  }
  return extractBridgeWebhookIdentity([
    ...(customerEvents.data || []),
    ...(kycEvents.data || []),
  ]);
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
  const direction = input?.direction === "payout" ? "payout" : "receive";
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
  if (direction === "receive" && profileCountry !== country) {
    return { ok: false as const, status: 403, code: "receive_country_must_match_account_country" };
  }

  const commercialRail = findYellowCardCommercialRail({
    direction,
    countryCode: country,
    currency,
    channel: channel as "bank" | "mobile_money",
  });
  if (!commercialRail) {
    return { ok: false as const, status: 403, code: "yellow_card_commercial_corridor_unavailable" };
  }

  const policy = { enabled: true, code: "ok" as const, row: commercialRail };

  let bridgeIdentity: any = null;
  let webhookEvidence = extractBridgeWebhookIdentity([]);
  // Fill missing local KYC only from the user's verified Bridge customer
  // profile. Browser-supplied identity is never authoritative.
  if (profile.bridge_customer_id) {
    try {
      webhookEvidence = await loadSignedBridgeIdentityEvidence(profile.bridge_customer_id);
    } catch {
      return { ok: false as const, status: 503, code: "bridge_identity_evidence_lookup_failed" };
    }
  }
  if (profile.bridge_customer_id && (!profile.id_number || !profile.id_type || !profile.date_of_birth || !profile.address || !profile.phone)) {
    try {
      bridgeIdentity = await bridgeProvider.getCustomerProfile(profile.bridge_customer_id);
    } catch {
      bridgeIdentity = null;
    }
  }

  const kyc: YellowCardRetailKyc = {
    name: str(webhookEvidence.values.name || profile.full_name),
    country: normalizeYellowCardCountryCode(webhookEvidence.values.country || bridgeIdentity?.country || profile.country),
    phone: str(webhookEvidence.values.phone || bridgeIdentity?.phone || profile.phone),
    address: profileAddress(profile, bridgeIdentity, webhookEvidence.values),
    dob: formatDob(webhookEvidence.values.dob || bridgeIdentity?.date_of_birth || profile.date_of_birth),
    email: lower(webhookEvidence.values.email || profile.email),
    // Document identity may come only from signed Bridge evidence or a fresh,
    // authenticated Bridge customer read. Mutable browser metadata is never a
    // source for cross-provider full-KYC submission.
    idNumber: str(webhookEvidence.values.idNumber || bridgeIdentity?.id_number),
    idType: str(webhookEvidence.values.idType || bridgeIdentity?.id_type),
  };
  const kycFieldSources = {
    name: webhookEvidence.sources.name || "verified_local_profile",
    country: webhookEvidence.sources.country || (bridgeIdentity?.country ? "bridge_customer_api" : "verified_local_profile"),
    phone: webhookEvidence.sources.phone || (bridgeIdentity?.phone ? "bridge_customer_api" : "verified_local_profile"),
    address: webhookEvidence.sources.address || (bridgeIdentity?.address_object ? "bridge_customer_api" : "verified_local_profile"),
    dob: webhookEvidence.sources.dob || (bridgeIdentity?.date_of_birth ? "bridge_customer_api" : "verified_local_profile"),
    email: webhookEvidence.sources.email || "verified_local_profile",
    idNumber: webhookEvidence.sources.idNumber || (bridgeIdentity?.id_number ? "bridge_customer_api" : "unavailable"),
    idType: webhookEvidence.sources.idType || (bridgeIdentity?.id_type ? "bridge_customer_api" : "unavailable"),
  };
  const missingFullKyc = Object.entries(kyc).filter(([, value]) => !value).map(([key]) => key);
  const reducedKycCoreComplete = Boolean(kyc.name && kyc.country && kyc.email);

  // These provider catalog calls are independent. Running them sequentially can
  // consume two full upstream timeout windows and makes the UI abandon a valid
  // preflight before it completes.
  const [channelsResult, networksResult, ratesResult] = await Promise.all([
    yellowCardReadWithRetry({ method: "GET", path: "/channels", query: { country } }),
    yellowCardReadWithRetry({ method: "GET", path: "/networks", query: { country } }),
    direction === "receive" && missingFullKyc.length > 0
      ? yellowCardReadWithRetry({ method: "GET", path: "/rates", query: { currency }, timeoutMs: 10_000 })
      : Promise.resolve(null),
  ]);
  if (!channelsResult.ok) {
    return { ok: false as const, status: 502, code: channelsResult.error || "yellow_card_channels_failed" };
  }
  if (!networksResult.ok) {
    return { ok: false as const, status: 502, code: networksResult.error || "yellow_card_networks_failed" };
  }
  const buyRate = ratesResult?.ok ? yellowCardBuyRate(ratesResult.data, currency) : null;
  const usdEquivalent = buyRate === null ? null : localAmount / buyRate;
  // Yellow Card's documented Tier 0 contract permits reduced KYC only below
  // USD 20 equivalent, with customerUID, and excludes BWP/NGN/ZAR. Bridge
  // approval remains mandatory above, proving that the customer was screened.
  // Yellow Card independently enforces its USD 200 lifetime Tier 0 ceiling.
  const reducedKycEligible = yellowCardReducedKycEligible({
    direction,
    currency,
    usdEquivalent,
    missingFullKyc: missingFullKyc.length > 0,
    coreComplete: reducedKycCoreComplete,
  });
  const kycTier: "full" | "reduced" = reducedKycEligible ? "reduced" : "full";
  const missingKyc = reducedKycEligible ? [] : missingFullKyc;
  const routing = resolveYellowCardRouting({
    channels: channelsResult.data,
    networks: networksResult.data,
    country,
    currency,
    rail: channel as "bank" | "mobile_money",
    direction,
    networkId: input?.network_id,
    amount: localAmount,
  });
  if (routing.channelAvailable && !routing.amountAvailable) {
    return { ok: false as const, status: 422, code: "yellow_card_amount_outside_provider_limits" };
  }

  const chain = settlementCurrency === "USDC" ? "base" : "tron";
  const activeStatuses = ["active", "enabled", "ready", "provisioned"];
  const walletSelect = "address,status,currency,chain,updated_at";
  const [userWallets, businessWallets] = await Promise.all([
    supa.from("bridge_wallets").select(walletSelect).eq("user_id", userId).ilike("currency", settlementCurrency).ilike("chain", chain),
    supa.from("bridge_wallets").select(walletSelect).eq("business_user_id", userId).ilike("currency", settlementCurrency).ilike("chain", chain),
  ]);
  if (userWallets.error || businessWallets.error) {
    return { ok: false as const, status: 503, code: "settlement_wallet_lookup_failed" };
  }
  const settlementWallet = [...(userWallets.data || []), ...(businessWallets.data || [])]
    .filter((row: any) => str(row?.address) && activeStatuses.includes(lower(row?.status || "active")))
    .sort((a: any, b: any) => Date.parse(str(b?.updated_at)) - Date.parse(str(a?.updated_at)))[0];
  if (!settlementWallet?.address) {
    return { ok: false as const, status: 409, code: "active_settlement_wallet_required" };
  }
  const settlementInfo: YellowCardSettlement = settlementCurrency === "USDC"
    ? { cryptoCurrency: "USDC", cryptoNetwork: "BASE", walletAddress: str(settlementWallet.address) }
    : { cryptoCurrency: "USDT", cryptoNetwork: "TRC20", walletAddress: str(settlementWallet.address) };

  return {
    ok: true as const,
    country,
    direction,
    currency,
    channel,
    localAmount,
    policy: policy.row,
    profile,
    kyc,
    missingKyc,
    kycTier,
    usdEquivalent,
    kycFieldSources,
    bridgeEvidenceEventIds: webhookEvidence.eventIds,
    settlementInfo,
    channels: routing.channels,
    selectedChannel: routing.selectedChannel,
    networks: routing.networks,
    selectedNetwork: routing.selectedNetwork,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const access = await authenticateVerifiedAfricanRailsUser(supa, req);
  if (!access.allowed) return json({ success: false, code: access.code, error: access.message }, access.status);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, code: "invalid_json", error: "Invalid JSON body" }, 400);
  }

  const config = getYellowCardConfig();
  if (!config.configured || config.environment !== "production" || config.production_enabled !== true) {
    await recordAfricanRailsOperatorAlert(supa, {
      userId: access.user.id,
      endpoint: "yellowcard-receive",
      code: "yellow_card_production_unavailable",
      message: "Yellow Card production Receive is unavailable.",
    });
    return json({ success: false, code: "yellow_card_production_unavailable", error: "Yellow Card production Receive is unavailable." }, 503);
  }
  if (!flag("YC_PRODUCTION_ENABLED") || !flag("YC_PRODUCTION_RECEIVE_ENABLED")) {
    return json({ success: false, code: "yellow_card_receive_disabled", error: "Yellow Card Receive is temporarily unavailable." }, 503);
  }

  const action = lower(body?.action || "preflight");
  if (action === "status") {
    const sequenceId = str(body?.sequence_id);
    if (!sequenceId) return json({ success: false, code: "sequence_id_required" }, 400);
    const { data: existing } = await supa
      .from("yellowcard_transactions")
      .select("*")
      .eq("user_id", access.user.id)
      .eq("environment", "production")
      .eq("sequence_id", sequenceId)
      .maybeSingle();
    if (!existing) return json({ success: false, code: "yellow_card_transaction_not_found" }, 404);
    const provider = await yellowCardFetch({
      method: "GET",
      path: existing.direction === "payout"
        ? `/send/sequence-id/${encodeURIComponent(sequenceId)}`
        : `/receive/sequence-id/${encodeURIComponent(sequenceId)}`,
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

  if (action === "preflight_send" || action === "create_send") {
    return json({ success: false, code: "yellow_card_send_not_enabled", error: "Yellow Card Send is not enabled." }, 403);
  }
  const context = await loadContext(access.user.id, {
    ...body,
    direction: "receive",
  });
  if (!context.ok) return json({ success: false, code: context.code, error: "Yellow Card preflight failed." }, context.status);

  const customerFee = calculateYellowCardCustomerFee(context.policy, context.localAmount);
  if (!customerFee) {
    return json({ success: false, code: "yellow_card_commercial_pricing_unavailable", error: "Commercial pricing is unavailable for this amount." }, 409);
  }
  const markupPercent = africanRailMarkupPercentForAccount(context.profile?.account_type);
  const networkRequired = context.channel === "mobile_money";
  const blockers = [
    ...(context.missingKyc.length > 0 ? ["kyc_incomplete"] : []),
    ...(!context.selectedChannel ? ["active_channel_unavailable"] : []),
    ...(networkRequired && !context.selectedNetwork ? ["payment_network_required"] : []),
  ];
  const preflight = {
    corridor_allowed: true,
    country: context.country,
    currency: context.currency,
    channel: context.channel,
    local_amount: context.localAmount,
    transaction_fee: {
      provider_percent: customerFee.provider_fee_percent,
      provider_amount_local: customerFee.provider_amount_local,
      markup_percent: markupPercent,
      markup_amount_local: customerFee.borderpay_amount_local,
      total_amount_local: customerFee.customer_amount_local,
      effective_percent: customerFee.effective_percent,
      percent: customerFee.customer_fee_percent,
      local: customerFee.customer_fee_local,
      minimum_local: customerFee.customer_minimum_fee_local,
      maximum_local: customerFee.customer_maximum_fee_local,
      provider_local: customerFee.provider_fee_local,
      provider_minimum_local: customerFee.minimum_fee_local,
      provider_maximum_local: customerFee.maximum_fee_local,
      pricing_range: customerFee.range,
      source: context.policy?.source_document ?? null,
    },
    kyc_complete: context.missingKyc.length === 0,
    missing_kyc_fields: context.missingKyc,
    kyc_tier: context.kycTier,
    usd_equivalent: context.usdEquivalent,
    bridge_settlement_wallet_ready: false,
    settlement_source: "yellow_card_production",
    provider_environment: "production",
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
    blockers,
    can_create: blockers.length === 0,
  };
  if (action === "preflight" || action === "preflight_send") return json({ success: true, data: preflight });
  if (action !== "create_receive") return json({ success: false, code: "unsupported_action" }, 400);

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
    .eq("environment", "production")
    .eq("sequence_id", sequenceId)
    .maybeSingle();
  if (prior) {
    // A previous POST may have reached Yellow Card even when our caller timed
    // out before receiving the response. Reconcile the same sequence before
    // answering the retry; never generate or submit a replacement sequence.
    if (!prior.provider_transaction_id) {
      const reconciled = await yellowCardFetch({
        method: "GET",
        path: prior.direction === "payout"
          ? `/send/sequence-id/${encodeURIComponent(sequenceId)}`
          : `/receive/sequence-id/${encodeURIComponent(sequenceId)}`,
      });
      if (reconciled.ok) {
        const updates = providerFields(reconciled.data);
        const { data: updated } = await supa
          .from("yellowcard_transactions")
          .update(updates)
          .eq("id", prior.id)
          .select("*")
          .single();
        const transaction = updated || { ...prior, ...updates };
        return json({
          success: Boolean(transaction.provider_transaction_id),
          code: "idempotent_reconciled",
          data: { transaction: publicTransaction(transaction) },
        }, transaction.provider_transaction_id ? 200 : 409);
      }
    }
    return json({
      success: Boolean(prior.provider_transaction_id),
      code: prior.provider_transaction_id ? "idempotent_replay" : "yellow_card_reconciliation_required",
      data: { transaction: publicTransaction(prior) },
    }, prior.provider_transaction_id ? 200 : 409);
  }

  let providerBody: Record<string, unknown>;
  try {
    providerBody = buildYellowCardDirectSettlementReceivePayload({
      sequenceId,
      channelType: yellowCardPayloadAccountType(context.channel),
      localAmount: context.localAmount,
      country: context.country,
      currency: context.currency,
      reason: str(body?.reason),
      customerUID: access.user.id,
      recipient: context.kyc,
      kycTier: context.kycTier,
      source: {
        accountType: yellowCardPayloadAccountType(context.channel),
        accountNumber: str(body?.source_account),
        ...(context.selectedNetwork?.id ? { networkId: str(context.selectedNetwork.id) } : {}),
      },
      settlementInfo: context.settlementInfo,
      // Yellow Card requires this for redirect-based deposit channels such as
      // South Africa bank Receive. It is provider routing metadata; BorderPay
      // continues to render the transaction result from the API response.
      redirectUrl: `${APP_URL}/?screen=receive`,
    });
  } catch (error) {
    return json({ success: false, code: error instanceof Error ? error.message : "yellow_card_payload_invalid" }, 400);
  }

  const { data: inserted, error: insertError } = await supa
    .from("yellowcard_transactions")
    .insert({
      user_id: access.user.id,
      environment: "production",
      direction: "receive",
      sequence_id: sequenceId,
      country_code: context.country,
      currency: context.currency,
      channel: context.channel,
      provider_channel_id: str(context.selectedChannel?.id) || null,
      provider_network_id: str(context.selectedNetwork?.id) || null,
      local_amount: context.localAmount,
      settlement_currency: context.settlementInfo.cryptoCurrency,
      settlement_network: context.settlementInfo.cryptoNetwork,
      status: "submitted",
      request_payload: redactYellowCardReceivePayload(providerBody),
      metadata: {
        source: "yellow_card_production",
        kyc_tier: context.kycTier,
        usd_equivalent: context.usdEquivalent,
        kyc_field_sources: context.kycFieldSources,
        bridge_evidence_event_ids: context.bridgeEvidenceEventIds,
      },
    })
    .select("*")
    .single();
  if (insertError || !inserted) {
    return json({ success: false, code: "yellow_card_persistence_failed", error: "The transaction was not sent." }, 500);
  }

  const provider = await yellowCardFetch({
    method: "POST",
    path: "/receive",
    body: providerBody,
    // Sandbox creation is slower than catalog reads. The client waits 60s and
    // retries reconcile the same sequence ID, so allow the provider to finish.
    timeoutMs: 45_000,
  });
  if (!provider.ok && provider.status >= 500) {
    // A transport delay or upstream 5xx does not prove rejection. Reconcile
    // the same idempotent sequence before returning an honest pending state.
    const reconciled = await yellowCardReadWithRetry({
      method: "GET",
      path: `/receive/sequence-id/${encodeURIComponent(sequenceId)}`,
      timeoutMs: 20_000,
    });
    if (reconciled.ok) {
      const reconciledUpdates = providerFields(reconciled.data);
      const { data: reconciledRow } = await supa
        .from("yellowcard_transactions")
        .update(reconciledUpdates)
        .eq("id", inserted.id)
        .select("*")
        .single();
      return json({ success: true, code: "provider_reconciled", data: { transaction: publicTransaction(reconciledRow || { ...inserted, ...reconciledUpdates }) } });
    }
    if (reconciled.status === 404) {
      const failedUpdates = {
        status: "failed",
        provider_status: "not_created",
        provider_response: reconciled.data && typeof reconciled.data === "object" ? reconciled.data : {},
        last_error: "yellow_card_transaction_not_created",
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { data: failedRow } = await supa
        .from("yellowcard_transactions")
        .update(failedUpdates)
        .eq("id", inserted.id)
        .select("*")
        .single();
      return json({
        success: false,
        code: "yellow_card_transaction_not_created",
        error: "Yellow Card did not create this transaction. Do not retry until the corridor is confirmed available.",
        data: { transaction: publicTransaction(failedRow || { ...inserted, ...failedUpdates }) },
      }, 422);
    }
    const pendingUpdates = {
      status: "submitted",
      provider_status: "confirmation_pending",
      provider_response: provider.data && typeof provider.data === "object" ? provider.data : {},
      last_error: provider.error || "provider_confirmation_pending",
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await supa.from("yellowcard_transactions").update(pendingUpdates).eq("id", inserted.id);
    return json({
      success: true,
      code: "provider_confirmation_pending",
      data: { transaction: publicTransaction({ ...inserted, ...pendingUpdates }) },
    }, 202);
  }
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
      error: "The Yellow Card production request was rejected.",
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
