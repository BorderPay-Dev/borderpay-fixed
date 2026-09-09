import {
  approvalAllowsProduct,
  approvalAllowsScopes,
  isApprovedPartnerRecord,
  normalizeApprovedPartnerProducts,
  requirePartnerContactEmail,
  requirePartnerApprovalText,
  tenantRequestsPartnerAccess,
} from "../supabase/functions/_shared/api-partner-approval.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn: () => unknown, contains: string): void {
  try {
    fn();
  } catch (error) {
    assert(String(error).includes(contains), `expected error containing ${contains}`);
    return;
  }
  throw new Error("expected function to throw");
}

const apiApproval = { status: "approved", approved_products: ["api"] };
const whiteLabelApproval = { status: "approved", approved_products: ["white_label"] };

Deno.test("ordinary business or tenant presence is not partner approval", () => {
  assert(!isApprovedPartnerRecord(null));
  assert(!isApprovedPartnerRecord({ status: "pending", approved_products: ["api"] }));
  assert(!isApprovedPartnerRecord({ status: "approved", approved_products: [] }));
  assert(!approvalAllowsProduct({ status: "suspended", approved_products: ["api"] }, "api"));
});

Deno.test("approval products are explicit and white-label keys are least privilege", () => {
  assertEquals(normalizeApprovedPartnerProducts(["white_label", "white_label"]), ["white_label"]);
  assert(approvalAllowsScopes(apiApproval, ["customers:write", "transfers:write"]));
  assert(approvalAllowsScopes(whiteLabelApproval, ["onboarding:write"]));
  assert(!approvalAllowsScopes(whiteLabelApproval, ["onboarding:write", "transfers:write"]));
  assertThrows(() => normalizeApprovedPartnerProducts([]), "api and/or white_label");
  assertThrows(() => normalizeApprovedPartnerProducts(["admin"]), "api and/or white_label");
});

Deno.test("white-label activation is recognized independently of normal business signup", () => {
  assertEquals(tenantRequestsPartnerAccess({}), { onboarding: false, whiteLabel: false });
  assertEquals(tenantRequestsPartnerAccess({
    onboarding: { business_signup_enabled: true },
  }), { onboarding: true, whiteLabel: false });
  assertEquals(tenantRequestsPartnerAccess({
    white_label: { enabled: true },
  }), { onboarding: false, whiteLabel: true });
});

Deno.test("approval evidence cannot silently omit approvers or references", () => {
  assertEquals(requirePartnerApprovalText(" ENG-42 ", "reference"), "ENG-42");
  assertThrows(() => requirePartnerApprovalText("", "compliance_approved_by"), "required");
  assertThrows(() => requirePartnerApprovalText("x".repeat(501), "reference"), "too long");
});

Deno.test("partner operational contacts are required and validated", () => {
  assertEquals(requirePartnerContactEmail(" OPS@Partner.example ", "incident_contact_email"), "ops@partner.example");
  assertThrows(() => requirePartnerContactEmail("not-an-email", "technical_contact_email"), "valid email");
  assertThrows(() => requirePartnerContactEmail("", "compliance_contact_email"), "required");
});

Deno.test("browser partner portal cannot create or forge approval", async () => {
  const source = await Deno.readTextFile("supabase/functions/api-partner-portal/index.ts");
  assert(source.includes('.from("api_partner_approvals")'));
  assert(source.includes("isApprovedPartnerRecord(approval)"));
  assert(!source.includes('"approve_partner"'));
  assert(!source.includes("body.approved_products"));
  const approvalLookup = source.indexOf('.from("api_partner_approvals")');
  const bodyParse = source.indexOf("body = await req.json()");
  assert(approvalLookup >= 0 && bodyParse > approvalLookup, "approval must be resolved before browser actions");
});

Deno.test("operator approval cannot silently activate stale tenant state", async () => {
  const source = await Deno.readTextFile("supabase/functions/api-gateway-admin/index.ts");
  const approvalStart = source.indexOf('if (action === "approve_partner")');
  const approvalEnd = source.indexOf('if (action === "suspend_partner")', approvalStart);
  const approval = source.slice(approvalStart, approvalEnd);
  assert(approval.includes("tenant.is_active === true"));
  assert(approval.includes("storedPartnerAccess.onboarding"));
  assert(approval.includes("storedPartnerAccess.whiteLabel"));
  assert(approval.includes("activeKeyCount"));
  assert(approval.indexOf("tenant_quarantine_required") < approval.indexOf(".upsert(approval"));
});
