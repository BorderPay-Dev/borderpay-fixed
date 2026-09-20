import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import {
  customerAppOrigin,
  loadPublishedWhiteLabel,
  validateWhiteLabelBrand,
} from "../supabase/functions/_shared/white-label-config.ts";
const brand = {
  brand_name: "Partner",
  legal_name: "Partner Ltd",
  logo_url: "https://partner.example/logo.png",
  primary_color: "#C7FF00",
  app_origin: "https://app.partner.example",
  support_email: "help@partner.example",
  support_url: "https://partner.example/support",
  privacy_url: "https://partner.example/privacy",
  terms_url: "https://partner.example/terms",
  legal_version: "2026-09",
};
function database(rows: Record<string, any>, errors: Record<string, any> = {}) {
  return {
    from(table: string) {
      const filters: Record<string, any> = {};
      const q: any = {
        select() {
          return q;
        },
        eq(k: string, v: any) {
          filters[k] = v;
          return q;
        },
        in(k: string, v: any) {
          filters[k] = v;
          return q;
        },
        async maybeSingle() {
          const row = rows[table];
          return {
            data: row &&
                Object.entries(filters).every((
                  [k, v],
                ) => (Array.isArray(v) ? v.includes(row[k]) : row[k] === v))
              ? row
              : null,
            error: errors[table] || null,
          };
        },
      };
      return q;
    },
  };
}
const records = () => ({
  white_label_releases: {
    tenant_id: "tenant-a",
    app_origin: brand.app_origin,
    published: brand,
    revision: 1,
    managed_key_id: "internal-key",
    status: "live",
    domain_verified_at: "2026-09-17",
  },
  api_tenants: { id: "tenant-a", is_active: true, default_mode: "production", metadata: {production_access:true} },
  api_partner_approvals: {
    tenant_id: "tenant-a",
    status: "approved",
    approved_products: ["white_label"],
  },
});
Deno.test("brand contract rejects missing legal destinations, credential URLs and unreadable accents", () => {
  assertEquals(validateWhiteLabelBrand(brand).app_origin, brand.app_origin);
  for (
    const patch of [
      { privacy_url: "" },
      { terms_url: "javascript:alert(1)" },
      { logo_url: "https://user:secret@partner.example/logo.png" },
      { app_origin: "https://partner.example/path" },
      { primary_color: "#000000" },
      { support_email: "bad" },
    ]
  ) assertThrows(() => validateWhiteLabelBrand({ ...brand, ...patch }));
});
Deno.test("published config requires exact origin, active tenant and product approval", async () => {
  assertEquals(
    (await loadPublishedWhiteLabel(database(records()), {
      origin: brand.app_origin,
    }))?.brand.brand_name,
    "Partner",
  );
  assertEquals(
    await loadPublishedWhiteLabel(database(records()), {
      origin: "https://evil.example",
    }),
    null,
  );
  for (const change of ["inactive", "draft", "unverified", "api-only", "sandbox"]) {
    const r = records();
    if (change === "sandbox") r.api_tenants.default_mode = "sandbox";
    if (change === "inactive") r.api_tenants.is_active = false;
    if (change === "draft") r.white_label_releases.status = "draft";
    if (change === "unverified") r.white_label_releases.domain_verified_at = "";
    if (change === "api-only") {
      r.api_partner_approvals.approved_products = ["api"];
    }
    assertEquals(
      await loadPublishedWhiteLabel(database(r), { origin: brand.app_origin }),
      null,
    );
  }
});
Deno.test("configuration outages never fall back to another tenant", async () => {
  await assertRejects(() =>
    loadPublishedWhiteLabel(
      database({}, { white_label_releases: { message: "offline" } }),
      { origin: brand.app_origin },
    )
  );
});
Deno.test("return URLs come from immutable owner and published release", async () => {
  const r = {
    ...records(),
    account_origin_provenance: {
      user_id: "u1",
      tenant_id: "tenant-a",
      onboarding_channel: "white_label",
    },
  };
  assertEquals(
    await customerAppOrigin(
      database(r),
      "u1",
      "https://app.borderpayafrica.com",
    ),
    brand.app_origin,
  );
  assertEquals(
    await customerAppOrigin(
      database(r),
      "direct-user",
      "https://app.borderpayafrica.com",
    ),
    "https://app.borderpayafrica.com",
  );
  r.white_label_releases.status = "suspended";
  await assertRejects(() =>
    customerAppOrigin(database(r), "u1", "https://app.borderpayafrica.com")
  );
});
import { prepareWhiteLabelSignup } from "../supabase/functions/_shared/white-label-onboarding.ts";
import { verifyOnboardingToken } from "../supabase/functions/_shared/onboarding-policy.ts";
Deno.test("managed signup binds server tenant, account types and accepted documents", async () => {
  const r: any = records();
  r.api_tenants.metadata = {production_access:true,
    onboarding: {
      white_label_signup_enabled: true,
      business_signup_enabled: true,
    },
  };
  r.api_keys = {
    id: "internal-key",
    tenant_id: "tenant-a",
    is_active: true,
    revoked_at: null,
  };
  const inserts: any[] = [];
  const base = database(r);
  const db = {
    from(table: string) {
      const q = base.from(table);
      q.is = q.eq;
      q.insert = async (value: any) => {
        inserts.push({ table, value });
        return { error: null };
      };
      return q;
    },
  };
  const secret = "test-signing-secret-at-least-32-characters";
  const body = {
    email: "pilot@example.com",
    account_type: "business",
    white_label_revision: 1,
    white_label_legal_version: brand.legal_version,
    accept_partner_terms: true,
  };
  const result = await prepareWhiteLabelSignup(
    db,
    brand.app_origin,
    body,
    secret,
  );
  const claims = await verifyOnboardingToken(result.token, secret);
  assertEquals(claims.tenant_id, "tenant-a");
  assertEquals(claims.allowed_account_types, ["business"]);
  assertEquals(inserts.map((x) => x.table), [
    "api_onboarding_authorizations",
    "white_label_legal_acceptances",
  ]);
  assertEquals(inserts[1].value.terms_url, brand.terms_url);
  for (
    const patch of [{ accept_partner_terms: false }, {
      white_label_revision: 0,
    }, { account_type: "individual" }]
  ) {
    await assertRejects(() =>
      prepareWhiteLabelSignup(
        db,
        brand.app_origin,
        { ...body, ...patch },
        secret,
      )
    );
  }
  r.white_label_releases.status = "pilot";
  r.white_label_releases.pilot_emails = ["invited@example.com"];
  await assertRejects(() =>
    prepareWhiteLabelSignup(db, brand.app_origin, body, secret)
  );
  const pilot = await prepareWhiteLabelSignup(db, brand.app_origin, {
    ...body,
    email: "invited@example.com",
  }, secret);
  assertEquals(
    (await verifyOnboardingToken(pilot.token, secret)).tenant_id,
    "tenant-a",
  );
  r.api_keys.is_active = false;
  await assertRejects(() =>
    prepareWhiteLabelSignup(db, brand.app_origin, {
      ...body,
      email: "invited@example.com",
    }, secret)
  );
});
import { applyWhiteLabelEmail } from "../supabase/functions/_shared/white-label-email.ts";
Deno.test("transaction email keeps money and references while branding links, HTML and text", () => {
  const rendered = applyWhiteLabelEmail({
    subject: "BorderPay payment received",
    html:
      '<body>BorderPay: 8,876.00 EUR <a href="https://app.borderpayafrica.com/transactions/abc">View</a> support@borderpayafrica.com</body>',
    text:
      "BorderPay: 8,876.00 EUR Ref abc https://app.borderpayafrica.com/transactions/abc",
  }, {
    brandName: "Partner & Co",
    primaryColor: "#C7FF00",
    logoUrl: brand.logo_url,
    supportEmail: brand.support_email,
    appOrigin: brand.app_origin,
    legalName: brand.legal_name,
    termsUrl: brand.terms_url,
    privacyUrl: brand.privacy_url,
  });
  assertEquals(rendered.subject, "Partner & Co payment received");
  assertEquals(rendered.html.includes("Partner &amp; Co: 8,876.00 EUR"), true);
  assertEquals(
    rendered.html.includes(brand.app_origin + "/transactions/abc"),
    true,
  );
  assertEquals(rendered.text.includes("8,876.00 EUR Ref abc"), true);
  assertEquals(rendered.text.includes(brand.terms_url), true);
  assertEquals(rendered.html.includes(brand.privacy_url), true);
});
