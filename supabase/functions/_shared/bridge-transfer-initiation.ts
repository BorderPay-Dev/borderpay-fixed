import type { TransferCreateInput } from "./providers/types.ts";

/** Bridge initiation is write-only: https://apidocs.bridge.xyz/platform/wallets/move-money */
export type WalletInitiationRequirement = {
  customer_id: string;
  wallet_id: string;
  required: boolean;
};
export type TransferInitiation = {
  channel: NonNullable<TransferCreateInput["sca_attestation"]>["channel"];
  subchannel: "remote";
  attestations: { sca: { outcome: "sca_used" } };
};

// External withdrawals are not the app's peer-to-peer payment flow. Existing
// native clients already send a mobile UA; no store update or client SCA flag
// is needed. Channel is reporting context, never an authentication factor.
export function withdrawalInitiationChannel(headers: Headers): TransferInitiation["channel"] {
  const ua = headers.get("user-agent") || "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
    || headers.get("sec-ch-ua-mobile") === "?1"
    ? "other_mobile_payment" : "other";
}

export function transferInitiation(
  requirement: WalletInitiationRequirement | null,
  attestation: TransferCreateInput["sca_attestation"],
): TransferInitiation | null {
  if (!requirement?.required) return null;
  if (!attestation || attestation.outcome !== "sca_used"
    || !["other", "other_mobile_payment", "p2p_mobile_payment"].includes(attestation.channel)
    || attestation.subchannel !== "remote") {
    throw new Error("bridge_wallet_sca_required");
  }
  return {
    channel: attestation.channel,
    subchannel: attestation.subchannel,
    attestations: { sca: { outcome: attestation.outcome } },
  };
}
