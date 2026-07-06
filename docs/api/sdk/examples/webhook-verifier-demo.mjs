import { verifyBorderPayWebhook } from "../typescript/dist/index.js";

async function main() {
  const rawBody = JSON.stringify({ event: "transfer.completed", transfer_id: "tr_123" });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signingSecret = process.env.SIGNING_SECRET || "replace_me";

  // In real server code, read this from `x-borderpay-signature`
  const signatureHeader = process.env.SIGNATURE || "sha256=replace_me";

  const result = await verifyBorderPayWebhook({
    rawBody,
    timestamp,
    signatureHeader,
    signingSecret,
  });

  console.log(result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
