import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBorderPayWebhook } from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function hmacSha256Hex(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function run() {
  const fixturePath = resolve(__dirname, '../../../mocks/webhooks/transfer.completed.json');
  const rawBody = (await readFile(fixturePath, 'utf8')).trim();

  const signingSecret = 'bwhsec_test_secret_value';
  const now = Math.floor(Date.now() / 1000);
  const timestamp = String(now);
  const sig = await hmacSha256Hex(signingSecret, `${timestamp}.${rawBody}`);

  const valid = await verifyBorderPayWebhook({
    rawBody,
    timestamp,
    signatureHeader: `sha256=${sig}`,
    signingSecret,
    nowUnixSeconds: now,
    toleranceSeconds: 300,
  });
  assert(valid.valid === true, 'valid signature should pass');

  const validNoPrefix = await verifyBorderPayWebhook({
    rawBody,
    timestamp,
    signatureHeader: sig,
    signingSecret,
    nowUnixSeconds: now,
    toleranceSeconds: 300,
  });
  assert(validNoPrefix.valid === true, 'raw hex signature should pass');

  const missing = await verifyBorderPayWebhook({
    rawBody,
    timestamp,
    signatureHeader: '',
    signingSecret,
    nowUnixSeconds: now,
  });
  assert(missing.valid === false && missing.reason === 'missing_header', 'missing header should fail');

  const badTs = await verifyBorderPayWebhook({
    rawBody,
    timestamp: 'abc',
    signatureHeader: `sha256=${sig}`,
    signingSecret,
    nowUnixSeconds: now,
  });
  assert(badTs.valid === false && badTs.reason === 'invalid_timestamp', 'invalid timestamp should fail');

  const oldTs = await verifyBorderPayWebhook({
    rawBody,
    timestamp: String(now - 601),
    signatureHeader: `sha256=${sig}`,
    signingSecret,
    nowUnixSeconds: now,
    toleranceSeconds: 300,
  });
  assert(oldTs.valid === false && oldTs.reason === 'timestamp_out_of_window', 'stale timestamp should fail');

  const mismatch = await verifyBorderPayWebhook({
    rawBody,
    timestamp,
    signatureHeader: `sha256=${sig}`,
    signingSecret: 'wrong_secret',
    nowUnixSeconds: now,
  });
  assert(mismatch.valid === false && mismatch.reason === 'signature_mismatch', 'wrong secret should fail');

  console.log('webhook_conformance: PASS');
}

run().catch((err) => {
  console.error('webhook_conformance: FAIL', err?.message || err);
  process.exit(1);
});
