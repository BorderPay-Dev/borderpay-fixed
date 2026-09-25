// Synthetic HTTP integration: no provider, customer, or email network traffic.
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
Deno.test("repair handler preserves restrictions, deduplicates email and never provisions unverified users", async () => {
  const originalFetch = globalThis.fetch, originalServe = Deno.serve;
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SEND_EMAIL_INTERNAL_TOKEN",
    "BRIDGE_API_KEY",
    "BRIDGE_BASE_URL",
    "BRIDGE_ONBOARDING_ENABLED",
  ];
  const previous = names.map((n) => Deno.env.get(n));
  names.forEach((n, i) =>
    Deno.env.set(
      n,
      [
        "https://synthetic.supabase.invalid",
        "synthetic-service-secret",
        "synthetic-email-secret",
        "synthetic-api-secret",
        "https://synthetic.bridge.invalid",
        "true",
      ][i],
    )
  );
  let handler: (r: Request) => Promise<Response>;
  Deno.serve = ((h: typeof handler) => {
    handler = h;
    return {};
  }) as typeof Deno.serve;
  let confirmed = true,
    frozen = false,
    existingBusiness = false,
    duplicate = false,
    sentBefore = false;
  let creates = 0, emails = 0, tokens = 0, patches = 0;
  const profile = () => ({
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.invalid",
    full_name: "Synthetic Owner",
    account_type: "business",
    country: "GB",
    account_status: frozen ? "frozen" : "pending_kyc",
    payment_provider: "bridge",
    bridge_customer_id: null,
  });
  const business = () => ({
    user_id: "11111111-1111-4111-8111-111111111111",
    company_name: "Synthetic Ltd",
    country: "GB",
    status: "active",
    bridge_customer_id: existingBusiness ? "existing-customer" : null,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url), method = request.method;
    const reply = (data: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(data), {
          headers: { "content-type": "application/json" },
        }),
      );
    if (url.pathname.includes("/auth/v1/admin/users/")) {
      return reply({
        ...profile(),
        email_confirmed_at: confirmed ? "2026-09-25" : null,
      });
    }
    if (url.pathname.endsWith("/user_profiles")) {
      if (method === "PATCH") {
        patches++;
        return reply([{ id: "11111111-1111-4111-8111-111111111111" }]);
      }
      return reply(
        url.searchParams.get("select") === "id,full_name,account_type"
          ? profile()
          : [profile()],
      );
    }
    if (url.pathname.endsWith("/business_profiles")) {
      if (method === "PATCH") return reply([]);
      if (url.searchParams.get("select") === "company_name") {
        return reply(business());
      }
      return reply([
        business(),
        ...(duplicate && !url.searchParams.has("user_id")
          ? [{
            ...business(),
            user_id: "22222222-2222-4222-8222-222222222222",
            bridge_customer_id: "other-customer",
          }]
          : []),
      ]);
    }
    if (url.pathname.endsWith("/email_log")) {
      return reply(sentBefore ? { status: "sent" } : null);
    }
    if (url.pathname.endsWith("/rpc/issue_email_token")) {
      tokens++;
      return reply("synthetic-token");
    }
    if (url.pathname.endsWith("/send-email")) {
      emails++;
      const payload = await request.json();
      assert(payload.idempotency_key, "email needs idempotency");
      return reply({ success: true, data: { status: "sent" } });
    }
    if (url.hostname === "synthetic.bridge.invalid" && method === "POST") {
      creates++;
      assert(
        request.headers.get("Idempotency-Key") ===
          "borderpay:customer:11111111-1111-4111-8111-111111111111",
        "stable customer idempotency",
      );
      return reply({ id: "created-customer" });
    }
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  }) as typeof fetch;
  try {
    await import(
      "../supabase/functions/bridge-missing-customer-migration/index.ts"
    );
    const call = async (body: unknown, token = "synthetic-service-secret") => {
      const response = await handler!(
        new Request("https://synthetic.invalid", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
      return { status: response.status, body: await response.json() };
    };
    const payload = { emails: ["owner@example.invalid"], notify: true };
    assert(
      (await call(payload, `e30.${btoa('{"role":"service_role"}')}.fake`))
        .status === 401,
      "forged token accepted",
    );
    assert(
      (await call({ ...payload, dry_run: true })).body.data.results[0]
        .status === "would_create",
      "dry run failed",
    );
    assert(creates + emails + patches === 0, "dry run mutated");
    frozen = true;
    assert(
      (await call(payload)).body.data.results[0].reason ===
        "account_restricted",
      "frozen account not skipped",
    );
    frozen = false;
    existingBusiness = true;
    assert(
      (await call(payload)).body.data.results[0].status === "already_exists",
      "business ID ignored",
    );
    existingBusiness = false;
    duplicate = true;
    assert(
      (await call(payload)).body.data.results[0].reason ===
        "duplicate_business_requires_review",
      "duplicate ignored",
    );
    duplicate = false;
    confirmed = false;
    assert(
      (await call(payload)).body.data.results[0].status ===
        "verification_email_requested",
      "unverified needs email",
    );
    assert(
      creates === 0 && emails === 1 && tokens === 1,
      "unverified user provisioned",
    );
    sentBefore = true;
    await call(payload);
    assert(emails === 1 && tokens === 1, "verification email/token duplicated");
    confirmed = true;
    const result = (await call(payload)).body.data.results[0];
    assert(
      result.status === "created" && result.email_status === "sent",
      "confirmed creation/welcome failed",
    );
    assert(
      creates === 1 && patches === 1 && emails === 2,
      "unexpected effects",
    );
  } finally {
    globalThis.fetch = originalFetch;
    Deno.serve = originalServe;
    names.forEach((n, i) =>
      previous[i] === undefined
        ? Deno.env.delete(n)
        : Deno.env.set(n, previous[i]!)
    );
  }
});
