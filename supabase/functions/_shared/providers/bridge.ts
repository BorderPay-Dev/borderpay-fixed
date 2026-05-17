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
 * exponential backoff. Cards are intentionally NOT implemented — Bridge
 * cards aren't in our self-serve plan, and the UI marks the section as
 * "Coming Soon".
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

  // ── Onboarding (KYC / KYB) ────────────────────────────────────────────────
  async createKycLink(input: KycLinkInput): Promise<KycLinkResult> {
    const body: Record<string, unknown> = {
      customer_id:  input.customer_id,
      type:         input.account_type,                // 'individual'|'business'
      redirect_uri: input.redirect_url || KYC_REDIRECT_URL,
      endorsements: input.endorsements ?? ["base"],
    };
    const r = await bridgeFetch({
      method: "POST", path: "/v0/kyc_links", body,
      idempotencyKey: `borderpay:kyc:${input.customer_id}`,
    });
    if (!r.ok) throw new Error(`Bridge createKycLink failed: ${r.error || r.status}`);
    const data = (r.data as any)?.data ?? r.data;
    const url  = data?.kyc_link?.url || data?.url || data?.link;
    const id   = data?.kyc_link?.id  || data?.id;
    if (!url || !id) throw new Error("Bridge createKycLink: missing link/url");
    return {
      provider: this.name, link_id: String(id), link_url: String(url),
      expires_at: data?.expires_at, raw: r.data,
    };
  }

  // ── Virtual accounts (USD/EUR/GBP) ────────────────────────────────────────
  async createVirtualAccount(input: VirtualAccountCreateInput): Promise<VirtualAccountResult> {
    const body: Record<string, unknown> = {
      currency: input.currency.toLowerCase(),
    };
    if (input.destination) {
      body.destination = {
        payment_rail: input.destination.payment_rail,
        currency:     input.destination.currency.toLowerCase(),
        ...(input.destination.chain   ? { chain:   input.destination.chain.toLowerCase() } : {}),
        ...(input.destination.address ? { address: input.destination.address } : {}),
      };
    }
    const r = await bridgeFetch({
      method: "POST",
      path:   `/v0/customers/${encodeURIComponent(input.customer_id)}/virtual_accounts`,
      body,
      idempotencyKey: `borderpay:va:${input.customer_id}:${input.currency}`,
    });
    if (!r.ok) throw new Error(`Bridge createVirtualAccount failed: ${r.error || r.status}`);
    const data = (r.data as any)?.data ?? r.data;
    return {
      provider:           this.name,
      virtual_account_id: String(data?.id),
      account_number:     data?.source_deposit_instructions?.bank_account_number,
      routing_number:     data?.source_deposit_instructions?.bank_routing_number,
      iban:               data?.source_deposit_instructions?.iban,
      bic:                data?.source_deposit_instructions?.bic,
      bank_name:          data?.source_deposit_instructions?.bank_name,
      currency:           input.currency,
      raw:                r.data,
    };
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
      source: {
        payment_rail: input.source.payment_rail,
        currency:     String(input.source.currency).toLowerCase(),
        ...(input.source.chain ? { chain: input.source.chain.toLowerCase() } : {}),
        ...(input.source.customer_id ? { from_address: undefined, customer_id: input.source.customer_id } : {}),
      },
      destination: {
        payment_rail: input.destination.payment_rail,
        currency:     String(input.destination.currency).toLowerCase(),
        ...(input.destination.chain    ? { chain:    input.destination.chain.toLowerCase() } : {}),
        ...(input.destination.address  ? { to_address: input.destination.address } : {}),
        ...(input.destination.bank_account ? {
          bank_account_number: input.destination.bank_account.account_number,
          bank_routing_number: input.destination.bank_account.routing_number,
          iban:                input.destination.bank_account.iban,
          bic:                 input.destination.bank_account.bic,
        } : {}),
      },
      ...(input.developer_fee ? {
        developer_fee_percent: input.developer_fee.percentage,
        developer_fee_amount:  input.developer_fee.flat_amount,
      } : {}),
    };
    const r = await bridgeFetch({
      method: "POST", path: "/v0/transfers", body,
      idempotencyKey: input.idempotency_key,
    });
    if (!r.ok) throw new Error(`Bridge createTransfer failed: ${r.error || r.status}`);
    const data = (r.data as any)?.data ?? r.data;
    const state = String(data?.state || data?.status || "pending").toLowerCase();
    return {
      provider:    this.name,
      transfer_id: String(data?.id),
      state:       (["pending","processing","succeeded","failed"].includes(state)
                     ? state as TransferResult["state"]
                     : "pending"),
      raw:         r.data,
    };
  }
}

export const bridgeProvider = new BridgeProvider();
