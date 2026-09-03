import { assertEquals } from "jsr:@std/assert@1";
import { evaluateBusinessEmail } from "../supabase/functions/_shared/business-email-policy.ts";

Deno.test("business signup accepts a company domain", () => {
  assertEquals(evaluateBusinessEmail("owner@acme-payments.co.ke"), {
    allowed: true,
    domain: "acme-payments.co.ke",
    code: "allowed",
  });
});

Deno.test("business signup rejects personal email providers", () => {
  for (const email of [
    "owner@gmail.com",
    "owner@outlook.com",
    "owner@yahoo.co.uk",
    "owner@proton.me",
  ]) {
    assertEquals(evaluateBusinessEmail(email).allowed, false, email);
  }
});

Deno.test("inbox.eu is accepted only for a UK business signup", () => {
  assertEquals(evaluateBusinessEmail("owner@inbox.eu", "GB").allowed, true);
  assertEquals(evaluateBusinessEmail("owner@inbox.eu", "UK").allowed, true);
  assertEquals(evaluateBusinessEmail("owner@inbox.eu", "KE").allowed, false);
  assertEquals(evaluateBusinessEmail("owner@inbox.eu", "FR").allowed, false);
});

Deno.test("business signup rejects disposable, reserved, and malformed domains", () => {
  for (const email of [
    "owner@mailinator.com",
    "owner@company.test",
    "owner@example.com",
    "owner@localhost",
    "not-an-email",
  ]) {
    assertEquals(evaluateBusinessEmail(email).allowed, false, email);
  }
});

Deno.test("business signup rejects confirmed hostile test identities", () => {
  for (const email of ["tst@hacker.com", "loadtest_123@company.com"]) {
    assertEquals(evaluateBusinessEmail(email).code, "blocked_identity", email);
  }
});
