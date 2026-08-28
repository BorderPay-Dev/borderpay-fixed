const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fromBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("yellow_card_recipient_key_invalid");
  }
}
function toBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function asBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer as ArrayBuffer;
}

async function key(encoded: string): Promise<CryptoKey> {
  const bytes = fromBase64(encoded.trim());
  if (bytes.byteLength !== 32) throw new Error("yellow_card_recipient_key_invalid");
  return crypto.subtle.importKey("raw", asBuffer(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function aad(payoutId: string, version: string) {
  if (!payoutId || !version) throw new Error("yellow_card_recipient_identity_invalid");
  return encoder.encode(`borderpay:yellowcard-recipient:${payoutId}:${version}`);
}

export async function encryptYellowCardRecipient(
  recipient: Record<string, unknown>,
  payoutId: string,
  version: string,
  encodedKey: string,
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBuffer(nonce), additionalData: asBuffer(aad(payoutId, version)) },
    await key(encodedKey),
    encoder.encode(JSON.stringify(recipient)),
  );
  return `v1.${toBase64(nonce)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptYellowCardRecipient(
  envelope: string,
  payoutId: string,
  version: string,
  encodedKey: string,
): Promise<Record<string, unknown>> {
  const [format, nonceValue, ciphertextValue] = String(envelope || "").split(".");
  if (format !== "v1" || !nonceValue || !ciphertextValue) throw new Error("yellow_card_recipient_envelope_invalid");
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBuffer(fromBase64(nonceValue)),
        additionalData: asBuffer(aad(payoutId, version)),
      },
      await key(encodedKey),
      asBuffer(fromBase64(ciphertextValue)),
    );
    const parsed = JSON.parse(decoder.decode(plaintext));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid recipient");
    return parsed;
  } catch {
    throw new Error("yellow_card_recipient_decryption_failed");
  }
}
