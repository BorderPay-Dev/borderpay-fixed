# RC1 External Audit Sink

This control is the supported alternative when hosted Supabase cannot enable
the required PGAudit session settings. It does not redefine an ordinary
Supabase table as authoritative. Certification passes only when the local
hash-chained events have independently signed receipts proving retention in an
external append-only store.

## Security claim

The evidence supports this bounded statement:

> No privileged certification-critical mutation was observed by the deployed
> controls during the marked certification window, and the complete observed
> sequence was retained by an independent sink.

It does not retroactively certify accounts created before the controls were
deployed. It also does not prove that a database administrator with sufficient
privilege could never disable every database-side control. Certification must
therefore use a newly created direct Business account and a short, supervised
capture window.

## Components

- `20260822090000_certification_external_audit_ledger.sql` attaches row and
  truncate triggers to certification-critical relations. Events use one global
  sequence and SHA-256 chain.
- `certification-audit-delivery` sends claimed events to an HTTPS sink and
  accepts a receipt only after Ed25519 verification.
- `20260823090000_certification_audit_delivery_schedule.sql` invokes the
  delivery worker every minute using endpoint and token values held in
  Supabase Vault. Missing or invalid Vault configuration fails closed.
- `verify_external_audit_ledger.py` validates the exported chain, trusted public
  key fingerprint, signed receipts, correlation markers, retention and any
  observed privileged mutations.

Authentication secrets and bank account details are excluded from captured row
values. The event still records the relation, operation, record identifier and
changed field names.

## Required external sink contract

The sink must:

1. Authenticate the bearer token and verify `x-borderpay-audit-signature`, an
   HMAC-SHA256 signature over the exact request body.
2. Deduplicate by `event.event_id`.
3. Persist the exact event in independently administered append-only storage.
4. Apply object lock in `COMPLIANCE` mode for at least 30 days.
5. Return JSON containing:
   `receipt_id`, `event_id`, `sequence_no`, `event_hash`, `stored_at`,
   `retention_until`, `object_lock_mode`, `key_id`, and `signature`.
6. Sign the canonical JSON of all receipt fields except `signature` using an
   Ed25519 private key held only by the external sink.
7. Export the complete contiguous sequence from the START marker through the
   END marker, including each signed receipt and its object-lock metadata.

The public key fingerprint must be independently pinned as
`CERTIFICATION_AUDIT_SINK_PUBLIC_KEY_SHA256`; accepting a key supplied only
inside the evidence bundle is prohibited.

## Required Edge Function configuration

- `CERTIFICATION_AUDIT_WORKER_TOKEN`
- `CERTIFICATION_AUDIT_SINK_URL` (HTTPS only)
- `CERTIFICATION_AUDIT_SINK_TOKEN`
- `CERTIFICATION_AUDIT_OUTBOUND_HMAC_SECRET`
- `CERTIFICATION_AUDIT_SINK_PUBLIC_KEY_BASE64` (raw Ed25519 public key)
- `CERTIFICATION_AUDIT_SINK_KEY_ID`
- `CERTIFICATION_AUDIT_MIN_RETENTION_DAYS` (integer, minimum `30`)

The delivery function must be invoked at least once per minute during the
certification window. Any pending or failed delivery, missing sequence, invalid
signature, mismatched event hash, missing START/END marker, insufficient
retention, or untrusted public-key fingerprint blocks certification.

The database Vault must contain exactly one active value for each name:

- `certification_audit_worker_url`
- `certification_audit_worker_token`

The URL must be the deployed HTTPS `certification-audit-delivery` endpoint.
The token must match `CERTIFICATION_AUDIT_WORKER_TOKEN` configured on that Edge
Function. Neither value belongs in source control or migration SQL.

## Activation order

1. Provision the independently administered WORM sink and Ed25519 signer.
2. Record and review the sink public-key SHA-256 fingerprint out of band.
3. Deploy the migration.
4. Configure and deploy `certification-audit-delivery`.
5. Configure the worker URL and token in Supabase Vault and deploy the
   once-per-minute schedule migration.
6. Confirm a real event receives a valid COMPLIANCE-mode receipt.
7. Record the worker deployment ID, control-schema hash, test receipt ID,
   independently verified public-key fingerprint, and health-check timestamp.
8. Confirm both pending and failed delivery counts are zero.
9. Create a new direct BorderPay Business certification account.
10. Start the marked capture window only after the delivery queue is empty.

No production migration, function deployment, sink provisioning or evidence
capture is performed by adding this implementation to the repository.
