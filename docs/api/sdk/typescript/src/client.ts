import type {
  BorderPayErrorEnvelope,
  BorderPayGatewayHealth,
  BorderPayMode,
  BorderPaySuccessEnvelope,
  CreateCustomerRequest,
  CreateCustomerResponseData,
  CreateTransferRequest,
  CreateTransferResponseData,
  CreateVirtualAccountRequest,
  CreateVirtualAccountResponseData,
  CreateWalletRequest,
  CreateWalletResponseData,
  CreateWebhookRequest,
  CreateWebhookResponseData,
} from "./types.js";

export interface BorderPayClientConfig {
  apiKey: string;
  gatewayUrl: string;
  mode?: BorderPayMode;
  fetchImpl?: typeof fetch;
  /** End-customer Supabase access token. Keep API keys on your server. */
  customerAccessToken?: string | (() => string | Promise<string>);
}

export class BorderPayApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown> | null;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = "BorderPayApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class BorderPayClient {
  private readonly apiKey: string;
  private readonly gatewayUrl: string;
  private readonly mode: BorderPayMode;
  private readonly fetchImpl: typeof fetch;
  private readonly customerAccessToken?:
    BorderPayClientConfig["customerAccessToken"];

  constructor(config: BorderPayClientConfig) {
    this.customerAccessToken = config.customerAccessToken;
    this.apiKey = config.apiKey;
    this.gatewayUrl = config.gatewayUrl.replace(/\/+$/, "");
    this.mode = config.mode ?? "sandbox";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async health(): Promise<BorderPaySuccessEnvelope<BorderPayGatewayHealth>> {
    return this.call<BorderPayGatewayHealth>({
      method: "GET",
      route: "/v1/health",
      body: { method: "GET" },
    });
  }

  async createCustomer(
    input: CreateCustomerRequest,
    idempotencyKey: string,
  ): Promise<BorderPaySuccessEnvelope<CreateCustomerResponseData>> {
    return this.call<CreateCustomerResponseData>({
      method: "POST",
      route: "/v1/customers",
      idempotencyKey,
      body: input,
    });
  }

  async createWallet(
    input: CreateWalletRequest,
    idempotencyKey: string,
  ): Promise<BorderPaySuccessEnvelope<CreateWalletResponseData>> {
    return this.call<CreateWalletResponseData>({
      method: "POST",
      route: "/v1/wallets",
      idempotencyKey,
      body: input,
    });
  }

  async createVirtualAccount(
    input: CreateVirtualAccountRequest,
    idempotencyKey: string,
  ): Promise<BorderPaySuccessEnvelope<CreateVirtualAccountResponseData>> {
    return this.call<CreateVirtualAccountResponseData>({
      method: "POST",
      route: "/v1/virtual-accounts",
      idempotencyKey,
      body: input,
    });
  }

  async createTransfer(
    input: CreateTransferRequest,
    idempotencyKey: string,
  ): Promise<BorderPaySuccessEnvelope<CreateTransferResponseData>> {
    return this.call<CreateTransferResponseData>({
      method: "POST",
      route: "/v1/transfers",
      idempotencyKey,
      body: input,
    });
  }

  async createPayout(
    input: CreateTransferRequest,
    idempotencyKey: string,
  ): Promise<BorderPaySuccessEnvelope<CreateTransferResponseData>> {
    return this.call<CreateTransferResponseData>({
      method: "POST",
      route: "/v1/payouts",
      idempotencyKey,
      body: input,
    });
  }

  async createWebhook(
    input: CreateWebhookRequest,
    idempotencyKey: string,
  ): Promise<BorderPaySuccessEnvelope<CreateWebhookResponseData>> {
    return this.call<CreateWebhookResponseData>({
      method: "POST",
      route: "/v1/webhooks",
      idempotencyKey,
      body: input,
    });
  }

  createOnboardingAuthorization(
    input: Record<string, unknown>,
    idempotencyKey: string,
  ) {
    return this.call<Record<string, unknown>>({
      method: "POST",
      route: "/v1/onboarding-authorizations",
      body: input,
      idempotencyKey,
    });
  }
  getCustomer() {
    return this.call<Record<string, unknown>>({
      method: "GET",
      route: "/v1/customers",
    });
  }
  verificationLinks() {
    return this.call<Record<string, unknown>>({
      method: "POST",
      route: "/v1/verification-links",
    });
  }
  listWallets() {
    return this.call<Record<string, unknown>>({
      method: "GET",
      route: "/v1/wallets",
    });
  }
  balances() {
    return this.call<Record<string, unknown>>({
      method: "GET",
      route: "/v1/balances",
    });
  }
  listVirtualAccounts() {
    return this.call<Record<string, unknown>>({
      method: "GET",
      route: "/v1/virtual-accounts",
    });
  }
  listExternalAccounts() {
    return this.call<Record<string, unknown>>({
      method: "GET",
      route: "/v1/external-accounts",
    });
  }
  saveExternalAccount(
    account: Record<string, unknown>,
    idempotencyKey: string,
    sca_authorization_id?: string,
  ) {
    return this.call<Record<string, unknown>>({
      method: "POST",
      route: "/v1/external-accounts",
      body: { account, sca_authorization_id },
      idempotencyKey,
    });
  }
  deleteExternalAccount(
    external_account_id: string,
    idempotencyKey: string,
    sca_authorization_id?: string,
  ) {
    return this.call<Record<string, unknown>>({
      method: "DELETE",
      route: "/v1/external-accounts",
      body: { external_account_id, sca_authorization_id },
      idempotencyKey,
    });
  }
  listExternalWallets() {
    return this.call<Record<string, unknown>>({
      method: "GET",
      route: "/v1/external-wallets",
    });
  }
  saveExternalWallet(
    input: {
      label: string;
      asset: "USDC" | "USDT" | "EURC";
      chain: "base" | "tron";
      address: string;
    },
    idempotencyKey: string,
  ) {
    return this.call<Record<string, unknown>>({
      method: "POST",
      route: "/v1/external-wallets",
      body: input,
      idempotencyKey,
    });
  }
  deleteExternalWallet(id: string, idempotencyKey: string) {
    return this.call<Record<string, unknown>>({
      method: "DELETE",
      route: "/v1/external-wallets",
      body: { id },
      idempotencyKey,
    });
  }
  listTransfers(
    input: { transfer_id?: string; after?: string; limit?: number } = {},
  ) {
    return this.call<Record<string, unknown>>({
      method: "GET",
      route: "/v1/transfers",
      body: input,
    });
  }
  authorizePayment(
    request: CreateTransferRequest,
    pin: string,
    totp: string,
    idempotencyKey: string,
  ) {
    return this.call<
      { required: boolean; authorization_id?: string; expires_at?: string }
    >({
      method: "POST",
      route: "/v1/payment-authorizations",
      body: { request, pin, totp },
      idempotencyKey,
    });
  }
  authorizeBeneficiary(
    request: Record<string, unknown>,
    pin: string,
    totp: string,
  ) {
    return this.call<
      { required: boolean; authorization_id?: string; expires_at?: string }
    >({
      method: "POST",
      route: "/v1/beneficiary-authorizations",
      body: { request, pin, totp },
    });
  }

  private async call<T>(input: {
    method: "GET" | "POST" | "DELETE";
    route: string;
    body?: unknown;
    idempotencyKey?: string;
  }): Promise<BorderPaySuccessEnvelope<T>> {
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "x-borderpay-route": input.route,
      "x-borderpay-mode": this.mode,
    };

    const customerToken = typeof this.customerAccessToken === "function"
      ? await this.customerAccessToken()
      : this.customerAccessToken;
    if (customerToken) {
      headers["X-BorderPay-Customer-Authorization"] = `Bearer ${customerToken}`;
    }

    if (input.idempotencyKey) {
      headers["Idempotency-Key"] = input.idempotencyKey;
    }

    const res = await this.fetchImpl(this.gatewayUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...(input.body as Record<string, unknown> || {}),
        method: input.method,
      }),
    });

    const parsed = (await res.json().catch(() => ({}))) as
      | BorderPaySuccessEnvelope<T>
      | BorderPayErrorEnvelope
      | Record<string, unknown>;

    if (res.ok) {
      return parsed as BorderPaySuccessEnvelope<T>;
    }

    const err = parsed as BorderPayErrorEnvelope;
    const code = err?.error?.code ?? "internal_error";
    const message = err?.error?.message ??
      `Request failed with status ${res.status}`;
    const details = err?.error?.details ?? null;
    throw new BorderPayApiError(code, message, res.status, details);
  }
}
