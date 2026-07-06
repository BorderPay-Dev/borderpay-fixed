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
}

export class BorderPayApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown> | null;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown> | null) {
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

  constructor(config: BorderPayClientConfig) {
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

  async createCustomer(input: CreateCustomerRequest, idempotencyKey: string): Promise<BorderPaySuccessEnvelope<CreateCustomerResponseData>> {
    return this.call<CreateCustomerResponseData>({
      method: "POST",
      route: "/v1/customers",
      idempotencyKey,
      body: input,
    });
  }

  async createWallet(input: CreateWalletRequest, idempotencyKey: string): Promise<BorderPaySuccessEnvelope<CreateWalletResponseData>> {
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

  async createTransfer(input: CreateTransferRequest, idempotencyKey: string): Promise<BorderPaySuccessEnvelope<CreateTransferResponseData>> {
    return this.call<CreateTransferResponseData>({
      method: "POST",
      route: "/v1/transfers",
      idempotencyKey,
      body: input,
    });
  }

  async createPayout(input: CreateTransferRequest, idempotencyKey: string): Promise<BorderPaySuccessEnvelope<CreateTransferResponseData>> {
    return this.call<CreateTransferResponseData>({
      method: "POST",
      route: "/v1/payouts",
      idempotencyKey,
      body: input,
    });
  }

  async createWebhook(input: CreateWebhookRequest, idempotencyKey: string): Promise<BorderPaySuccessEnvelope<CreateWebhookResponseData>> {
    return this.call<CreateWebhookResponseData>({
      method: "POST",
      route: "/v1/webhooks",
      idempotencyKey,
      body: input,
    });
  }

  private async call<T>(input: {
    method: "GET" | "POST";
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

    if (input.idempotencyKey) {
      headers["Idempotency-Key"] = input.idempotencyKey;
    }

    const res = await this.fetchImpl(this.gatewayUrl, {
      method: "POST",
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
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
    const message = err?.error?.message ?? `Request failed with status ${res.status}`;
    const details = err?.error?.details ?? null;
    throw new BorderPayApiError(code, message, res.status, details);
  }
}
