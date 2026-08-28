import {
  decryptYellowCardRecipient,
  encryptYellowCardRecipient,
} from "../supabase/functions/_shared/yellowcard-recipient-security.ts";

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

Deno.test("Yellow Card recipient PII is encrypted and bound to its payout", async () => {
  const recipient = { accountName: "Recipient", accountNumber: "123456", networkId: "bank-1" };
  const encrypted = await encryptYellowCardRecipient(recipient, "payout-1", "1", key);
  if (encrypted.includes("123456")) throw new Error("recipient PII stored in plaintext");
  const decrypted = await decryptYellowCardRecipient(encrypted, "payout-1", "1", key);
  if (decrypted.accountNumber !== "123456") throw new Error("recipient round trip failed");

  let rejected = false;
  try {
    await decryptYellowCardRecipient(encrypted, "payout-2", "1", key);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("ciphertext was reusable for another payout");
});
