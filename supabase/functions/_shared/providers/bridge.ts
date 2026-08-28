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
import { buildBridgeTransferBody } from "./bridge-transfer-payload.ts";
import type {
  PaymentProvider,
  CustomerCreateInput, CustomerCreateResult,
  KycLinkInput,        KycLinkResult,
  VirtualAccountCreateInput, VirtualAccountResult,
  WalletCreateInput,   WalletResult,
  TransferCreateInput, TransferResult,
  TransferStatusResult,
  LiquidationAddressCreateInput, LiquidationAddressResult,
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
    if (!r.ok) {
      const parsed = (r.data && typeof r.data === "object") ? (r.data as Record<string, unknown>) : {};
      const bridgeCode = typeof parsed.code === "string"
        ? parsed.code
        : typeof parsed.error_code === "string"
        ? String(parsed.error_code)
        : undefined;
      const bridgeErr = typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
        ? parsed.message
        : r.error;
      throw new BridgeProviderError(
        `Bridge createCustomer failed [${r.status}]`,
        {
          status: r.status,
          request_id: r.request_id,
          bridge_code: bridgeCode,
          bridge_error: bridgeErr,
          raw_text: r.raw_text?.slice(0, 1000),
        },
      );
    }
    const id = (r.data as any)?.id || (r.data as any)?.data?.id;
    if (!id) {
      throw new BridgeProviderError("Bridge createCustomer response missing id", {
        status: r.status,
        request_id: r.request_id,
        raw_text: r.raw_text?.slice(0, 1000),
      });
    }
    return { provider: this.name, provider_id: String(id), raw: r.data };
  }

  async deleteCustomer(customerId: string): Promise<{ deleted: boolean; raw: unknown }> {
    const r = await bridgeFetch({
      method: "DELETE",
      path: `/v0/customers/${encodeURIComponent(customerId)}`,
      idempotencyKey: `borderpay:delete-customer:${customerId}`,
    });
    if (!r.ok) {
      const parsed = (r.data && typeof r.data === "object") ? (r.data as Record<string, unknown>) : {};
      const bridgeCode = typeof parsed.code === "string"
        ? parsed.code
        : typeof parsed.error_code === "string"
        ? String(parsed.error_code)
        : undefined;
      const bridgeErr = typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
        ? parsed.message
        : r.error;
      throw new BridgeProviderError(
        `Bridge deleteCustomer failed [${r.status}]`,
        {
          status: r.status,
          request_id: r.request_id,
          bridge_code: bridgeCode,
          bridge_error: bridgeErr,
          raw_text: r.raw_text?.slice(0, 1000),
        },
      );
    }
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
      const parsed = (r.data && typeof r.data === "object") ? (r.data as Record<string, unknown>) : {};
      const bridgeCode = typeof parsed.code === "string"
        ? parsed.code
        : typeof parsed.error_code === "string"
        ? String(parsed.error_code)
        : undefined;
      const bridgeErr = typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
        ? parsed.message
        : r.error;
      throw new BridgeProviderError(
        `Bridge createKycLink failed [${r.status}]`,
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
    const url  = data?.kyc_link?.url || data?.kyc_link || data?.url || data?.link;
    const id   = data?.kyc_link?.id  || data?.id;
    if (!url || !id) {
      throw new BridgeProviderError(
        "Bridge createKycLink response missing link id/url",
        {
          status: r.status,
          request_id: r.request_id,
          raw_text: r.raw_text?.slice(0, 1000),
        },
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
    const destinationRail = input.destination?.payment_rail || input.destination?.rail;
    if (!input.destination?.address || !destinationRail || !input.destination?.currency) {
      throw new BridgeProviderError(
        "Bridge createVirtualAccount request invalid: destination wallet fields are required",
        {
          bridge_code: "invalid_parameters",
          bridge_error: "virtual account requires a destination stablecoin wallet (address + rail + currency)",
        },
      );
    }
    const feePercent = String(input.developer_fee_percent || "").trim();
    const feePercentNumber = Number(feePercent);
    const zeroFeeAllowed = input.allow_zero_developer_fee === true && feePercentNumber === 0;
    if (!/^\d+(\.\d+)?$/.test(feePercent) || !Number.isFinite(feePercentNumber) || (!zeroFeeAllowed && feePercentNumber <= 0) || feePercentNumber > 100) {
      throw new BridgeProviderError(
        "Bridge createVirtualAccount request invalid: developer_fee_percent must be a positive base-100 percentage",
        {
          bridge_code: "invalid_parameters",
          bridge_error: "virtual account requires developer_fee_percent as a positive base-100 percentage string",
        },
      );
    }
    const body: Record<string, unknown> = {
      developer_fee_percent: feePercent,
      source:      { currency: input.currency.toLowerCase() },
      destination: {
        currency:     input.destination.currency.toLowerCase(),
        payment_rail: destinationRail.toLowerCase(),
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
  async findCustomerByEmail(email: string): Promise<{ id: string; email: string | null; raw: unknown } | null> {
    const target = String(email || "").trim().toLowerCase();
    if (!target) return null;
    const matches: Array<{ id: string; email: string | null; raw: unknown }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const r = await bridgeFetch({
        method: "GET",
        path: "/v0/customers",
        query: {
          limit: 100,
          ...(cursor ? { after: cursor } : {}),
        },
      });
      if (!r.ok) {
        const parsed = (r.data && typeof r.data === "object") ? (r.data as Record<string, unknown>) : {};
        const bridgeCode = typeof parsed.code === "string"
          ? parsed.code
          : typeof parsed.error_code === "string"
          ? String(parsed.error_code)
          : undefined;
        const bridgeErr = typeof parsed.error === "string"
          ? parsed.error
          : typeof parsed.message === "string"
          ? parsed.message
          : r.error;
        throw new BridgeProviderError(
          `Bridge listCustomers failed [${r.status}]`,
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
      const rows = Array.isArray(data) ? data : Array.isArray((data as any)?.customers) ? (data as any).customers : [];
      for (const row of rows) {
        const rowEmail = String(row?.email ?? row?.business_email ?? row?.customer_email ?? "").trim().toLowerCase();
        if (rowEmail && rowEmail === target) {
          matches.push({ id: String(row?.id || ""), email: rowEmail, raw: row });
        }
      }
      if (matches.length > 1) {
        throw new BridgeProviderError("Bridge customer email maps to multiple customers", {
          status: 409,
          bridge_code: "ambiguous_customer_email",
          bridge_error: `Multiple Bridge customers found for ${target}`,
        });
      }

      const pagination = (r.data as any)?.pagination ?? (r.data as any)?.data?.pagination ?? {};
      const next =
        pagination?.next ??
        pagination?.next_cursor ??
        pagination?.after ??
        ((r.data as any)?.has_more && rows.length ? rows[rows.length - 1]?.id : undefined);
      if (!next || !rows.length) break;
      cursor = String(next);
    }
    return matches[0] ?? null;
  }

  /** Fetch canonical customer profile fields from Bridge. */
  async getCustomerProfile(customerId: string): Promise<{
    id: string;
    country: string | null;
    phone: string | null;
    date_of_birth: string | null;
    id_number: string | null;
    id_type: string | null;
    identity_metadata: {
      id_number_present: boolean;
      id_number_last4: string | null;
      id_number_source: string | null;
      id_type_source: string | null;
      date_of_birth_source: string | null;
    };
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
    if (!r.ok) {
      const parsed = (r.data && typeof r.data === "object") ? (r.data as Record<string, unknown>) : {};
      const bridgeCode = typeof parsed.code === "string"
        ? parsed.code
        : typeof parsed.error_code === "string"
        ? String(parsed.error_code)
        : undefined;
      const bridgeErr = typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
        ? parsed.message
        : r.error;
      throw new BridgeProviderError(
        `Bridge getCustomerProfile failed [${r.status}]`,
        {
          status: r.status,
          request_id: r.request_id,
          bridge_code: bridgeCode,
          bridge_error: bridgeErr,
          raw_text: r.raw_text?.slice(0, 1000),
        },
      );
    }
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
    const stringAt = (obj: unknown, path: string[]): string | null => {
      let current: unknown = obj;
      for (const key of path) {
        if (!current || typeof current !== "object" || Array.isArray(current)) return null;
        current = (current as Record<string, unknown>)[key];
      }
      const s = String(current ?? "").trim();
      return s.length ? s : null;
    };
    const firstString = (paths: string[][]): { value: string | null; source: string | null } => {
      for (const path of paths) {
        const value = stringAt(data, path);
        if (value) return { value, source: path.join(".") };
      }
      return { value: null, source: null };
    };
    const dateOfBirth = firstString([
      ["date_of_birth"],
      ["birth_date"],
      ["dob"],
      ["person", "date_of_birth"],
      ["person", "birth_date"],
      ["person", "dob"],
      ["personal_info", "date_of_birth"],
      ["individual", "date_of_birth"],
    ]);
    const idNumber = firstString([
      ["id_number"],
      ["identification_number"],
      ["tax_identification_number"],
      ["national_id_number"],
      ["person", "id_number"],
      ["person", "identification_number"],
      ["person", "national_id_number"],
      ["identity_document", "number"],
      ["identity_document", "id_number"],
      ["government_id", "number"],
      ["government_id", "id_number"],
      ["government_id_document", "number"],
      ["document", "number"],
      ["document", "id_number"],
    ]);
    const idType = firstString([
      ["id_type"],
      ["document_type"],
      ["identification_type"],
      ["tax_identification_number_type"],
      ["person", "id_type"],
      ["person", "document_type"],
      ["person", "identification_type"],
      ["identity_document", "type"],
      ["identity_document", "document_type"],
      ["government_id", "type"],
      ["government_id", "document_type"],
      ["government_id_document", "type"],
      ["document", "type"],
      ["document", "document_type"],
    ]);
    const idNumberDigits = (idNumber.value || "").replace(/\s+/g, "");
    return {
      id: String(data?.id ?? customerId),
      country: normalized(countryRaw),
      phone: data?.phone ? String(data.phone) : null,
      date_of_birth: dateOfBirth.value,
      id_number: idNumber.value,
      id_type: idType.value,
      identity_metadata: {
        id_number_present: Boolean(idNumber.value),
        id_number_last4: idNumberDigits ? idNumberDigits.slice(-4) : null,
        id_number_source: idNumber.source,
        id_type_source: idType.source,
        date_of_birth_source: dateOfBirth.source,
      },
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
    const rows = await this.fetchBridgeListPaginated<any>({
      path: `/v0/customers/${encodeURIComponent(customerId)}/wallets`,
      context: "listWallets",
    });
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
    if (!r.ok) {
      const parsed = (r.data && typeof r.data === "object") ? (r.data as Record<string, unknown>) : {};
      const bridgeCode = typeof parsed.code === "string"
        ? parsed.code
        : typeof parsed.error_code === "string"
        ? String(parsed.error_code)
        : undefined;
      const bridgeErr = typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
        ? parsed.message
        : r.error;
      throw new BridgeProviderError(
        `Bridge getWalletBalances failed [${r.status}]`,
        {
          status: r.status,
          request_id: r.request_id,
          bridge_code: bridgeCode,
          bridge_error: bridgeErr,
          raw_text: r.raw_text?.slice(0, 1000),
        },
      );
    }
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
    const rows = await this.fetchBridgeListPaginated<any>({
      path: `/v0/customers/${encodeURIComponent(customerId)}/virtual_accounts`,
      context: "listVirtualAccounts",
    });
    return (Array.isArray(rows) ? rows : []).map((v: any) => ({
      virtual_account_id: String(v?.id),
      currency:  String(v?.source_deposit_instructions?.currency || v?.currency || "").toUpperCase(),
      rail:      v?.source_deposit_instructions?.payment_rail || v?.rail,
      status:    v?.status,
      developer_fee_percent:
        v?.developer_fee_percent != null && Number.isFinite(Number(v.developer_fee_percent))
          ? Number(v.developer_fee_percent)
          : undefined,
      // Keep full provider payload + normalized deposit instructions so
      // downstream UI can render payment-instruction and account-letter URLs.
      account_details: {
        ...(v && typeof v === "object" ? v : {}),
        source_deposit_instructions:
          (v?.source_deposit_instructions && typeof v.source_deposit_instructions === "object")
            ? v.source_deposit_instructions
            : null,
      },
    }));
  }

  private async fetchBridgeListPaginated<T>(params: { path: string; context: string; pageSize?: number; maxPages?: number }): Promise<T[]> {
    const pageSize = Math.max(1, Math.min(200, Number(params.pageSize ?? 100)));
    const maxPages = Math.max(1, Math.min(50, Number(params.maxPages ?? 20)));
    const out: T[] = [];

    let cursor: string | undefined = undefined;
    let page = 0;
    let previousFirstId: string | null = null;
    const seenCursors = new Set<string>();

    while (page < maxPages) {
      const query: Record<string, string | number | boolean | undefined> = {
        limit: pageSize,
        ...(cursor ? { starting_after: cursor } : {}),
      };
      const r = await bridgeFetch({ method: "GET", path: params.path, query });
      if (!r.ok) {
        const parsed = (r.data && typeof r.data === "object") ? (r.data as Record<string, unknown>) : {};
        const bridgeCode = typeof parsed.code === "string"
          ? parsed.code
          : typeof parsed.error_code === "string"
          ? String(parsed.error_code)
          : undefined;
        const bridgeErr = typeof parsed.error === "string"
          ? parsed.error
          : typeof parsed.message === "string"
          ? parsed.message
          : r.error;
        throw new BridgeProviderError(
          `Bridge ${params.context} failed [${r.status}]`,
          {
            status: r.status,
            request_id: r.request_id,
            bridge_code: bridgeCode,
            bridge_error: bridgeErr,
            raw_text: r.raw_text?.slice(0, 1000),
          },
        );
      }

      const payload: any = (r.data as any) ?? {};
      const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
        ? payload
        : [];
      out.push(...rows);

      const hasMore = Boolean(payload?.has_more);
      const nextCursorRaw = payload?.next_starting_after ?? payload?.next_cursor ?? null;
      const nextCursor = nextCursorRaw != null ? String(nextCursorRaw) : null;
      const firstId = rows.length > 0 ? String(rows[0]?.id ?? "") : "";
      const lastId = rows.length > 0 ? String(rows[rows.length - 1]?.id ?? "") : "";

      // Termination order matters: if provider does not paginate this endpoint,
      // query params may be ignored and page 1 can repeat forever.
      if (rows.length === 0) break;
      if (rows.length < pageSize && !hasMore && !nextCursor) break;
      if (nextCursor && seenCursors.has(nextCursor)) break;
      if (!nextCursor && firstId && previousFirstId && firstId === previousFirstId) break;

      previousFirstId = firstId || previousFirstId;
      if (nextCursor) {
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      } else if (lastId) {
        cursor = lastId;
      } else {
        break;
      }
      page += 1;
    }

    return out;
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
    if (!r.ok) {
      const parsed = (r.data && typeof r.data === "object") ? (r.data as Record<string, unknown>) : {};
      const bridgeCode = typeof parsed.code === "string"
        ? parsed.code
        : typeof parsed.error_code === "string"
        ? String(parsed.error_code)
        : undefined;
      const bridgeErr = typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
        ? parsed.message
        : r.error;
      throw new BridgeProviderError(
        `Bridge createWallet failed [${r.status}]`,
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
    const body = buildBridgeTransferBody(input);
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

  async getTransfer(transferId: string): Promise<TransferStatusResult> {
    const id = String(transferId || "").trim();
    if (!id) throw new BridgeProviderError("Bridge transfer id is required");
    const r = await bridgeFetch({
      method: "GET",
      path: `/v0/transfers/${encodeURIComponent(id)}`,
      retryable: true,
    });
    if (!r.ok) {
      throw new BridgeProviderError(`Bridge getTransfer failed [${r.status}]`, {
        status: r.status,
        request_id: r.request_id,
        raw_text: r.raw_text?.slice(0, 1000),
      });
    }
    const data = (r.data as any)?.data ?? r.data;
    const returnedId = String(data?.id || id);
    const state = String(data?.state || data?.status || "unknown").toLowerCase();
    return { provider: this.name, transfer_id: returnedId, state, raw: r.data };
  }

  async createLiquidationAddress(input: LiquidationAddressCreateInput): Promise<LiquidationAddressResult> {
    const body: Record<string, unknown> = {
      currency: String(input.currency).toLowerCase(),
      chain: String(input.chain).toLowerCase(),
      destination_payment_rail: String(input.destination_payment_rail).toLowerCase(),
      destination_currency: String(input.destination_currency).toLowerCase(),
      destination_address: input.destination_address,
      return_address: input.return_address,
      // Bridge's liquidation-address API uses this field name. The shorter
      // `developer_fee_percent` belongs to other Bridge resources and is not
      // the source of truth for liquidation addresses.
      ...(input.developer_fee_percent
        ? String(input.chain).toLowerCase() === "tron"
          // Bridge currently rejects custom_developer_fee_percent on its
          // legacy USDT/Tron liquidation routes. Preserve route creation;
          // never simulate or deduct the missing provider fee ourselves.
          ? { developer_fee_percent: input.developer_fee_percent }
          : { custom_developer_fee_percent: input.developer_fee_percent }
        : {}),
    };
    const r = await bridgeFetch({
      method: "POST",
      path: `/v0/customers/${encodeURIComponent(input.customer_id)}/liquidation_addresses`,
      body,
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
        `Bridge createLiquidationAddress failed [${r.status}]`,
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
    return {
      provider: this.name,
      liquidation_address_id: String(data?.id || ""),
      address: String(data?.address || ""),
      state: String(data?.state || data?.status || "active").toLowerCase(),
      raw: r.data,
    };
  }

  async getLiquidationAddress(customerId: string, liquidationAddressId: string): Promise<Record<string, unknown>> {
    const r = await bridgeFetch({
      method: "GET",
      path: `/v0/customers/${encodeURIComponent(customerId)}/liquidation_addresses/${encodeURIComponent(liquidationAddressId)}`,
    });
    if (!r.ok) {
      throw new BridgeProviderError(`Bridge getLiquidationAddress failed [${r.status}]`, {
        status: r.status,
        request_id: r.request_id,
        bridge_error: r.error,
        raw_text: r.raw_text?.slice(0, 1000),
      });
    }
    const data = (r.data as any)?.data ?? r.data;
    return data && typeof data === "object" ? data as Record<string, unknown> : {};
  }

  async updateLiquidationAddressDeveloperFee(
    customerId: string,
    liquidationAddressId: string,
    feePercent: string,
  ): Promise<Record<string, unknown>> {
    const r = await bridgeFetch({
      method: "PUT",
      path: `/v0/customers/${encodeURIComponent(customerId)}/liquidation_addresses/${encodeURIComponent(liquidationAddressId)}`,
      body: { custom_developer_fee_percent: feePercent },
      idempotencyKey: null,
    });
    if (!r.ok) {
      throw new BridgeProviderError(`Bridge updateLiquidationAddressDeveloperFee failed [${r.status}]`, {
        status: r.status,
        request_id: r.request_id,
        bridge_error: r.error,
        raw_text: r.raw_text?.slice(0, 1000),
      });
    }
    const data = (r.data as any)?.data ?? r.data;
    return data && typeof data === "object" ? data as Record<string, unknown> : {};
  }
}

export const bridgeProvider = new BridgeProvider();
