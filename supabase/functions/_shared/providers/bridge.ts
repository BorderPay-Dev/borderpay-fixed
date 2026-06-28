/**
 * BridgeProvider — implements PaymentProvider against Bridge's REST API.
 *
 * Endpoints (per https://apidocs.bridge.xyz):
 *   • POST /v0/customers                                  → create customer (individual|business)
 *   • POST /v0/kyc_links                                  → hosted KYC URL
 *   • POST /v0/customers/{id}/virtual_accounts            → USD/EUR/GBP virtual account
 *   • POST /v0/customers/{id}/wallets                     → custodial stablecoin wallet
 *   • GET  /v0/customers/{id}/wallets/{wid}/balances      → balance snapshot
 *   • POST /v0/transfers                                  → orchestration / cross-border
 *
 * All calls go through `bridgeFetch` which adds Api-Key, Idempotency-Key,
 * exponential backoff. Cards are intentionally NOT implemented until card
 * access is approved; the UI marks the section as locked.
 */

import { bridgeFetch } from "./bridge-client.ts";
import type {
  PaymentProvider,
  CustomerCreateInput, CustomerCreateResult,
  KycLinkInput,        KycLinkResult,
  VirtualAccountCreateInput, VirtualAccountResult,
  WalletCreateInput,   WalletResult,
  TransferCreateInput, TransferResult,
} from "./types.ts";

export class BridgeProviderError extends Error {
  status?: number;
  request_id?: string;
  bridge_code?: string;
  bridge_error?: string;
  raw_text?: string;
  constructor(
    message: string,
    meta?: { status?: number; request_id?: string; bridge_code?: string; bridge_error?: string; raw_text?: string },
  ) {
    super(message);
    this.name = "BridgeProviderError";
    this.status = meta?.status;
    this.request_id = meta?.request_id;
    this.bridge_code = meta?.bridge_code;
    this.bridge_error = meta?.bridge_error;
    this.raw_text = meta?.raw_text;
  }
}

const KYC_REDIRECT_URL =
  Deno.env.get("BORDERPAY_APP_URL")
    ? `${Deno.env.get("BORDERPAY_APP_URL")}/onboarding/kyc-complete`
    : "https://app.borderpayafrica.com/onboarding/kyc-complete";

export class BridgeProvider implements PaymentProvider {
  readonly name = "bridge" as const;

  // ── Identity ──────────────────────────────────────────────────────────────
  async createCustomer(input: CustomerCreateInput): Promise<CustomerCreateResult> {
    const body: Record<string, unknown> = {
      type:           input.account_type,             // 'individual' | 'business'
      email:          input.email,
      address:        { country: input.country_code },
    };
    if (input.account_type === "individual") {
      const [first_name, ...rest] = (input.full_name || "").trim().split(/\s+/);
      body.first_name = first_name || "User";
      body.last_name  = rest.join(" ") || "Unknown";
      if (input.phone_e164) body.phone = input.phone_e164;
    } else {
      body.business_legal_name = input.company_name;
      if (input.registration_number) body.business_registration_number = input.registration_number;
    }
    body.metadata = { borderpay_user_id: input.borderpay_user_id };

    const r = await bridgeFetch({
      method: "POST", path: "/v0/customers", body,
      idempotencyKey: `borderpay:customer:${input.borderpay_user_id}`,
    });
    if (!r.ok) throw new Error(`Bridge createCustomer failed: ${r.error || r.status}`);
    const id = (r.data as any)?.id || (r.data as any)?.data?.id;
    if (!id) throw new Error("Bridge createCustomer: missing id");
    return { provider: this.name, provider_id: String(id), raw: r.data };
  }

  async deleteCustomer(customerId: string): Promise<{ deleted: boolean; raw: unknown }> {
    const r = await bridgeFetch({
      method: "DELETE",
      path: `/v0/customers/${encodeURIComponent(customerId)}`,
      idempotencyKey: `borderpay:delete-customer:${customerId}`,
    });
    if (!r.ok) throw new Error(`Bridge deleteCustomer failed: ${r.error || r.status}`);
    return { deleted: true, raw: r.data };
  }

  // ── Onboarding (KYC / KYB) ────────────────────────────────────────────────
  // Bridge `POST /v0/kyc_links`:
  //   • If customer_id is supplied, returns a KYC link for that existing
  //     customer (requires the customer to already have signed_agreement_id +
  //     base profile — i.e. went through /v0/customers).
  //   • If customer_id is NOT supplied, Bridge accepts full_name + email
  //     (+ business_legal_name for KYB) and creates the customer when the
  //     user completes the hosted flow. TOS is collected on the same page,
  //     so we don't need a separate /v0/customers/tos_links round-trip.
  //
  // We use the second mode because /v0/customers requires
  // signed_agreement_id + birth_date + a full address up-front — fields
  // that the user only enters during the hosted KYC flow. Pre-creating
  // the customer was returning 502 for every signup.
  //
  // Bridge response shape varies: the link may come back as
  // { kyc_link: { url, id } } or { url, id } at top level. We probe both
  // to stay tolerant of API revisions. On failure we include the raw
  // body so the operator can see what Bridge actually rejected.
  async createKycLink(input: KycLinkInput): Promise<KycLinkResult> {
    const body: Record<string, unknown> = {
      type:         input.account_type,
      redirect_uri: input.redirect_url || KYC_REDIRECT_URL,
      endorsements: input.endorsements ?? ["base"],
    };
    if (input.customer_id) {
      body.customer_id = input.customer_id;
    } else {
      // Embedded-customer mode.
      if (input.email)        body.email = input.email;
      if (input.account_type === "individual") {
        if (input.full_name)  body.full_name = input.full_name;
      } else {
        if (input.company_name) body.business_legal_name = input.company_name;
      }
    }
    const idemSource =
      input.customer_id ?? input.email ?? input.full_name ?? crypto.randomUUID();
    const r = await bridgeFetch({
      method: "POST", path: "/v0/kyc_links", body,
      idempotencyKey: `borderpay:kyc:${input.account_type}:${idemSource}`,
    });
    if (!r.ok) {
      // Bubble up the full Bridge response (truncated) so the function
      // log + edge-function HTTP response have something diagnostic.
      const detail = r.raw_text ? r.raw_text.slice(0, 800) : r.error || `HTTP ${r.status}`;
      throw new Error(`Verification link request failed [${r.status}]: ${detail}`);
    }
    const data = (r.data as any)?.data ?? r.data;
    const url  = data?.kyc_link?.url || data?.kyc_link || data?.url || data?.link;
    const id   = data?.kyc_link?.id  || data?.id;
    if (!url || !id) {
      throw new Error(
        `Verification link response missing link URL — keys=${Object.keys(data ?? {}).join(",")}`,
      );
    }
    return {
      provider: this.name, link_id: String(id), link_url: String(url),
      expires_at: data?.expires_at, raw: r.data,
    };
  }

  // ── Virtual accounts (USD/EUR/GBP) ────────────────────────────────────────
  // Bridge REQUIRES `source.currency` + a `destination` { currency (stablecoin),
  // payment_rail (blockchain), address }. Incoming fiat auto-converts to that
  // stablecoin at that address. Sending a flat `{ currency }` (the old shape)
  // makes Bridge reject with "resubmit the following parameters … missing/invalid".
  async createVirtualAccount(input: VirtualAccountCreateInput): Promise<VirtualAccountResult> {
    if (!input.destination?.address || !input.destination?.payment_rail || !input.destination?.currency) {
      throw new Error("virtual account requires a destination stablecoin wallet (address + rail + currency)");
    }
    if (!/^\d+(\.\d+)?$/.test(String(input.developer_fee_percent || "").trim())) {
      throw new Error("virtual account requires developer_fee_percent as numeric string");
    }
    const feePercent = String(input.developer_fee_percent).trim();
    const body: Record<string, unknown> = {
      developer_fee_percent: feePercent,
      source:      { currency: input.currency.toLowerCase() },
      destination: {
        currency:     input.destination.currency.toLowerCase(),
        payment_rail: input.destination.payment_rail.toLowerCase(),
        address:      input.destination.address,
      },
    };
    const r = await bridgeFetch({
      method: "POST",
      path:   `/v0/customers/${encodeURIComponent(input.customer_id)}/virtual_accounts`,
      body,
      idempotencyKey: input.idempotency_key || `borderpay:va:${input.customer_id}:${input.currency}`,
    });
    if (!r.ok) {
      const parsed = (r.data && typeof r.data === "object") ? (r.data as Record<string, unknown>) : {};
      const bridgeCode = typeof parsed.code === "string"
        ? parsed.code
        : typeof (parsed.error_code) === "string"
        ? String(parsed.error_code)
        : undefined;
      const bridgeErr = typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
        ? parsed.message
        : r.error;
      throw new BridgeProviderError(
        `Bridge createVirtualAccount failed [${r.status}]`,
        {
          status: r.status,
          request_id: r.request_id,
          bridge_code: bridgeCode,
          bridge_error: bridgeErr,
          raw_text: r.raw_text?.slice(0, 1000),
        },
      );
    }
    const data = (r.data as any)?.data ?? r.data;
    const sdi = data?.source_deposit_instructions ?? {};
    return {
      provider:           this.name,
      virtual_account_id: String(data?.id),
      account_number:     sdi?.bank_account_number,
      routing_number:     sdi?.bank_routing_number,
      iban:               sdi?.iban,
      bic:                sdi?.bic,
      bank_name:          sdi?.bank_name,
      currency:           input.currency,
      raw:                r.data,
    };
  }

  // ── Read-only sync helpers (GET — no money movement) ──────────────────────
  /** Fetch canonical customer profile fields from Bridge. */
  async getCustomerProfile(customerId: string): Promise<{
    id: string;
    country: string | null;
    phone: string | null;
    address_object: {
      street_line_1: string | null;
      street_line_2: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      country: string | null;
    } | null;
    raw: unknown;
  }> {
    const r = await bridgeFetch({ method: "GET", path: `/v0/customers/${encodeURIComponent(customerId)}` });
    if (!r.ok) throw new Error(`Bridge getCustomerProfile failed: ${r.error || r.status}`);
    const data = (r.data as any)?.data ?? r.data ?? {};
    const addr = data?.residential_address ?? data?.address ?? data?.business_address ?? data?.registered_address ?? {};
    const countryRaw =
      addr?.country ??
      data?.country ??
      data?.country_code ??
      data?.residential_address?.country ??
      null;
    const normalized = (v: unknown): string | null => {
      const s = String(v ?? "").trim();
      return s.length ? s.toUpperCase() : null;
    };
    return {
      id: String(data?.id ?? customerId),
      country: normalized(countryRaw),
      phone: data?.phone ? String(data.phone) : null,
      address_object: {
        street_line_1: addr?.street_line_1 ? String(addr.street_line_1) : null,
        street_line_2: addr?.street_line_2 ? String(addr.street_line_2) : null,
        city: addr?.city ? String(addr.city) : null,
        state: addr?.state ? String(addr.state) : null,
        postal_code: (addr?.postal_code ?? addr?.postcode ?? addr?.zip)
          ? String(addr?.postal_code ?? addr?.postcode ?? addr?.zip)
          : null,
        country: normalized(addr?.country),
      },
      raw: r.data,
    };
  }

  /** List the customer's custodial stablecoin wallets. */
  async listWallets(customerId: string): Promise<Array<{ wallet_id: string; currency: string; chain: string; address: string; balance?: string }>> {
    const r = await bridgeFetch({ method: "GET", path: `/v0/customers/${encodeURIComponent(customerId)}/wallets` });
    if (!r.ok) throw new Error(`Bridge listWallets failed: ${r.error || r.status}`);
    const rows = (r.data as any)?.data ?? r.data ?? [];
    // Bridge's wallet listing has historically returned slightly different
    // shapes (currency / symbol / coin / asset_code). Probe all of them and,
    // as a last resort, infer from the chain so the row never lands with an
    // empty currency (the DB now forbids that via a CHECK constraint).
    const inferFromChain = (chain: string): string => {
      const k = String(chain || "").toLowerCase();
      if (k === "tron") return "USDT";
      return "USDC";   // USDC is on every other supported rail
    };
    return (Array.isArray(rows) ? rows : []).map((w: any) => {
      const chain = String(w?.chain || "").toLowerCase();
      const raw =
        w?.currency || w?.symbol || w?.coin || w?.asset_code ||
        w?.asset?.symbol || w?.token || "";
      const currency = String(raw).toUpperCase() || inferFromChain(chain);
      return {
        wallet_id: String(w?.id),
        currency,
        chain,
        address:   String(w?.address || w?.deposit_address || ""),
        balance:   w?.balance != null ? String(w.balance) : undefined,
      };
    });
  }

  /** Get per-wallet balance rows from Bridge. */
  async getWalletBalances(customerId: string, walletId: string): Promise<Array<{ currency: string; chain?: string; balance: string }>> {
    const r = await bridgeFetch({
      method: "GET",
      path:   `/v0/customers/${encodeURIComponent(customerId)}/wallets/${encodeURIComponent(walletId)}/balances`,
    });
    if (!r.ok) throw new Error(`Bridge getWalletBalances failed: ${r.error || r.status}`);
    const payload = (r.data as any)?.data ?? r.data;

    // Some API shapes return an array of balances; others return one object.
    const rows = Array.isArray(payload?.balances)
      ? payload.balances
      : Array.isArray(payload)
      ? payload
      : [payload];

    return (rows || []).map((b: any) => ({
      currency: String(b?.currency || b?.symbol || ""),
      chain:    b?.chain ? String(b.chain) : undefined,
      balance:  String(
        b?.balance ??
        b?.available_balance ??
        b?.available ??
        "0",
      ),
    }));
  }

  /** List the customer's USD/EUR/GBP virtual accounts. */
  async listVirtualAccounts(customerId: string): Promise<Array<{ virtual_account_id: string; currency: string; rail?: string; status?: string; developer_fee_percent?: number; account_details: unknown }>> {
    const r = await bridgeFetch({ method: "GET", path: `/v0/customers/${encodeURIComponent(customerId)}/virtual_accounts` });
    if (!r.ok) throw new Error(`Bridge listVirtualAccounts failed: ${r.error || r.status}`);
    const rows = (r.data as any)?.data ?? r.data ?? [];
    return (Array.isArray(rows) ? rows : []).map((v: any) => ({
      virtual_account_id: String(v?.id),
      currency:  String(v?.source_deposit_instructions?.currency || v?.currency || "").toUpperCase(),
      rail:      v?.source_deposit_instructions?.payment_rail || v?.rail,
      status:    v?.status,
      developer_fee_percent:
        v?.developer_fee_percent != null && Number.isFinite(Number(v.developer_fee_percent))
          ? Number(v.developer_fee_percent)
          : undefined,
      account_details: v?.source_deposit_instructions ?? v,
    }));
  }

  // ── Custodial stablecoin wallet ───────────────────────────────────────────
  async createWallet(input: WalletCreateInput): Promise<WalletResult> {
    const body = {
      currency: input.symbol.toLowerCase(),
      chain:    input.chain.toLowerCase(),
    };
    const r = await bridgeFetch({
      method: "POST",
      path:   `/v0/customers/${encodeURIComponent(input.customer_id)}/wallets`,
      body,
      idempotencyKey: `borderpay:wallet:${input.customer_id}:${input.symbol}:${input.chain}`,
    });
    if (!r.ok) throw new Error(`Bridge createWallet failed: ${r.error || r.status}`);
    const data = (r.data as any)?.data ?? r.data;
    return {
      provider:        this.name,
      wallet_id:       String(data?.id),
      deposit_address: String(data?.address || data?.deposit_address || ""),
      symbol:          input.symbol,
      chain:           input.chain,
      raw:             r.data,
    };
  }

  // ── Money movement ────────────────────────────────────────────────────────
  async createTransfer(input: TransferCreateInput): Promise<TransferResult> {
    const body: Record<string, unknown> = {
      amount: input.source.amount,
      ...(input.on_behalf_of ? { on_behalf_of: input.on_behalf_of } : {}),
      source: {
        payment_rail: input.source.payment_rail,
        currency:     String(input.source.currency).toLowerCase(),
        ...(input.source.chain ? { chain: input.source.chain.toLowerCase() } : {}),
        ...(input.source.customer_id ? { customer_id: input.source.customer_id } : {}),
        ...(input.source.from_address ? { from_address: input.source.from_address } : {}),
        ...(input.source.bridge_wallet_id ? { bridge_wallet_id: input.source.bridge_wallet_id } : {}),
        ...(input.source.external_account_id ? { external_account_id: input.source.external_account_id } : {}),
      },
      destination: {
        payment_rail: input.destination.payment_rail,
        currency:     String(input.destination.currency).toLowerCase(),
        ...(input.destination.chain    ? { chain:    input.destination.chain.toLowerCase() } : {}),
        ...(input.destination.address  ? { to_address: input.destination.address } : {}),
        ...(input.destination.bridge_wallet_id ? { bridge_wallet_id: input.destination.bridge_wallet_id } : {}),
        ...(input.destination.external_account_id ? { external_account_id: input.destination.external_account_id } : {}),
        ...(input.destination.deposit_id ? { deposit_id: input.destination.deposit_id } : {}),
        ...(input.destination.bank_account ? {
          bank_account_number: input.destination.bank_account.account_number,
          bank_routing_number: input.destination.bank_account.routing_number,
          iban:                input.destination.bank_account.iban,
          bic:                 input.destination.bank_account.bic,
        } : {}),
      },
      ...(input.developer_fee ? {
        developer_fee_percent:
          input.developer_fee.percentage == null
            ? undefined
            : String(input.developer_fee.percentage),
        developer_fee_amount:  input.developer_fee.flat_amount,
      } : {}),
    };
    const r = await bridgeFetch({
      method: "POST", path: "/v0/transfers", body,
      idempotencyKey: input.idempotency_key,
    });
    if (!r.ok) {
      const parsed = (r.data && typeof r.data === "object") ? (r.data as Record<string, unknown>) : {};
      const bridgeCode =
        typeof parsed.code === "string"
          ? parsed.code
          : typeof parsed.error_code === "string"
          ? String(parsed.error_code)
          : undefined;
      const bridgeErr =
        typeof parsed.message === "string"
          ? parsed.message
          : typeof parsed.error === "string"
          ? parsed.error
          : r.error;
      throw new BridgeProviderError(
        `Bridge createTransfer failed [${r.status}]`,
        {
          status: r.status,
          request_id: r.request_id,
          bridge_code: bridgeCode,
          bridge_error: bridgeErr,
          raw_text: r.raw_text?.slice(0, 1000),
        },
      );
    }
    const data = (r.data as any)?.data ?? r.data;
    const state = String(data?.state || data?.status || "pending").toLowerCase();
    return {
      provider:    this.name,
      transfer_id: String(data?.id),
      state,
      raw:         r.data,
    };
  }
}

export const bridgeProvider = new BridgeProvider();
