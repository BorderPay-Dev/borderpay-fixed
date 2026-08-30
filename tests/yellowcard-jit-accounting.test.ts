import {
  buildYellowCardJitFundingTransfer,
  calculateYellowCardJitDebit,
} from "../supabase/functions/_shared/providers/yellowcard-jit.ts";
import { buildBridgeTransferBody } from "../supabase/functions/_shared/providers/bridge-transfer-payload.ts";

Deno.test("Yellow Card JIT debit adds the exact 2% BorderPay fee", () => {
  const amounts = calculateYellowCardJitDebit("100");
  if (amounts.settlementAmount !== "100") throw new Error("settlement amount changed");
  if (amounts.borderpayFeeAmount !== "2") throw new Error("2% fee missing");
  if (amounts.customerDebitAmount !== "102") throw new Error("customer debit is not settlement plus fee");
});

Deno.test("Yellow Card JIT Bridge leg delivers the exact net and captures only the 2% fee", () => {
  const transfer = buildYellowCardJitFundingTransfer({
    customerId: "customer-1",
    bridgeWalletId: "wallet-1",
    settlementAsset: "USDC",
    settlementNetwork: "BASE",
    settlementAmount: "100",
    yellowCardFundingAddress: "0x1111111111111111111111111111111111111111",
    idempotencyKey: "yc-jit:payout-1:fund",
  });
  const body = buildBridgeTransferBody(transfer);
  if (body.amount !== "102") throw new Error("gross debit is not settlement plus 2% fee");
  if (body.developer_fee !== "2") throw new Error("flat BorderPay fee missing");
  if ((body.destination as any).to_address !== "0x1111111111111111111111111111111111111111") {
    throw new Error("Yellow Card funding address changed");
  }
  if ("developer_fee_percent" in body && body.developer_fee_percent !== undefined) {
    throw new Error("percentage fee can introduce net settlement drift");
  }
});

Deno.test("Yellow Card JIT Bridge leg emits EEA attestation only after SCA", () => {
  const transfer = buildYellowCardJitFundingTransfer({
    customerId: "customer-1",
    bridgeWalletId: "wallet-1",
    settlementAsset: "USDT",
    settlementNetwork: "TRON",
    settlementAmount: "20",
    yellowCardFundingAddress: "TQ2h8u9mDLxV7KBMizEbjXasEhtdqL4NAB",
    idempotencyKey: "yc-jit:payout-2:fund",
    scaApplied: true,
  });
  const body = buildBridgeTransferBody(transfer);
  if ((body.initiation as any)?.attestations?.sca?.outcome !== "sca_used") {
    throw new Error("SCA attestation missing");
  }
});

Deno.test("Yellow Card JIT accounting is deterministic at six decimals", () => {
  const amounts = calculateYellowCardJitDebit("7.591234");
  if (amounts.borderpayFeeAmountMinor !== 151_825n) throw new Error("fee rounding drift");
  if (amounts.customerDebitAmountMinor !== 7_743_059n) throw new Error("debit rounding drift");
});

Deno.test("Yellow Card JIT accounting rejects excess precision and invalid values", () => {
  for (const value of ["0", "-1", "1.0000001", "NaN"]) {
    let rejected = false;
    try {
      calculateYellowCardJitDebit(value);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`invalid amount accepted: ${value}`);
  }
});
