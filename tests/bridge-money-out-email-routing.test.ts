const worker = await Deno.readTextFile("supabase/functions/process-pending-events/index.ts");

function assertIncludes(value: string, expected: string): void {
  if (!value.includes(expected)) throw new Error(`Expected worker to include: ${expected}`);
}

Deno.test("successful Bridge wallet-originated transfer sends an idempotent money-out receipt", () => {
  assertIncludes(worker, 'if (direction === "debit" && emailStatus === "approved")');
  assertIncludes(worker, "await emailWalletActivityBestEffort({");
  assertIncludes(worker, 'direction: "debit"');
  assertIncludes(worker, 'description: "Payment sent"');
  assertIncludes(worker, ':debit:completed`');
});

Deno.test("Bridge money-out receipt uses gross wallet debit and keeps other statuses on status email", () => {
  assertIncludes(worker, "minorToDecimal(receiptBreakdown.grossMinor, currency) : amount");
  assertIncludes(worker, "} else {\n        await emailTransactionStatusBestEffort({");
});
