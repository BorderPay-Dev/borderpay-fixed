import type { TransferCreateInput } from "./types.ts";

/**
 * Build the documented Bridge transfer body.
 *
 * Bridge identifies blockchain networks through `payment_rail` on transfer
 * endpoints. `source.chain` and `destination.chain` are internal routing
 * hints only and must never be serialized into POST /v0/transfers.
 */
export function buildBridgeTransferBody(input: TransferCreateInput): Record<string, unknown> {
  const bridgeRail = (rail: string) => String(rail || "").toLowerCase();
  return {
    ...(input.source.amount ? { amount: input.source.amount } : {}),
    ...(input.on_behalf_of ? { on_behalf_of: input.on_behalf_of } : {}),
    source: {
      payment_rail: bridgeRail(input.source.payment_rail),
      currency: String(input.source.currency).toLowerCase(),
      ...(input.source.from_address ? { from_address: input.source.from_address } : {}),
      ...(input.source.bridge_wallet_id ? { bridge_wallet_id: input.source.bridge_wallet_id } : {}),
      ...(input.source.external_account_id ? { external_account_id: input.source.external_account_id } : {}),
    },
    destination: {
      payment_rail: bridgeRail(input.destination.payment_rail),
      currency: String(input.destination.currency).toLowerCase(),
      ...(input.destination.address ? { to_address: input.destination.address } : {}),
      ...(input.destination.bridge_wallet_id ? { bridge_wallet_id: input.destination.bridge_wallet_id } : {}),
      ...(input.destination.external_account_id ? { external_account_id: input.destination.external_account_id } : {}),
      ...(input.destination.deposit_id ? { deposit_id: input.destination.deposit_id } : {}),
      ...(input.destination.bank_account ? {
        bank_account_number: input.destination.bank_account.account_number,
        bank_routing_number: input.destination.bank_account.routing_number,
        iban: input.destination.bank_account.iban,
        bic: input.destination.bank_account.bic,
      } : {}),
    },
    ...(input.developer_fee ? {
      developer_fee_percent:
        input.developer_fee.percentage == null
          ? undefined
          : String(input.developer_fee.percentage),
      developer_fee: input.developer_fee.flat_amount,
    } : {}),
    ...(input.features ? { features: input.features } : {}),
    ...(input.sca_attestation ? {
      initiation: {
        channel: input.sca_attestation.channel,
        subchannel: input.sca_attestation.subchannel,
        attestations: {
          sca: { outcome: input.sca_attestation.outcome },
        },
      },
    } : {}),
  };
}
