# Bridge payout initiation and SCA

Bridge's current wallet guide and Create Transfer schema require reading the source wallet before creating a transfer. Include initiation only when the wallet returns `initiation_required: true`; the field is write-only and does not appear in transfer responses or webhooks. `auth_factors` is optional for `sca_used`.

References checked September 16, 2026:
- https://apidocs.bridge.xyz/platform/wallets/move-money
- https://apidocs.bridge.xyz/api-reference/transfers/create-a-transfer
- https://apidocs.bridge.xyz/platform/additional-information/webhooks/structure

## Behavior

`bridge-transfer` reads the exact wallet under the canonical customer before consuming SCA. Missing, mismatched, inactive or malformed wallet responses fail closed. A successful response with an omitted/false initiation flag omits initiation from the outbound transfer, as Bridge specifies. EEA PIN/TOTP remains mandatory regardless of that flag, with business jurisdiction still taken from the incorporation country stored at signup. Bridge-required initiation outside the local SCA scope is blocked without inventing an exemption. Existing alternate EEA payment entrypoints remain blocked by their SCA guards.

For these external withdrawal flows, mobile user agents/client hints use `other_mobile_payment`; desktop uses `other`. All are `remote`. Client-supplied initiation or SCA outcome fields are not trusted. Existing native clients supply their mobile user agent, so this change requires no app-store binary or frontend deployment. It does not claim physical-device verification or resolve unrelated native build issues.

A preparation record in the existing `admin_action_audit` table stores the exact intended initiation object, canonical payment hash, wallet requirement, and local authorization ID before the provider POST. Failure to write it prevents the transfer. After a successful Bridge response, an acceptance record links the outgoing object to Bridge's request and transfer IDs. This documents what BorderPay sent and Bridge's HTTP success, not an independent regulatory attestation receipt. No PIN, OTP, bearer token or API key is stored in these records.

The acceptance record is independent of webhook metadata, which may be replaced during transfer reconciliation. If acceptance-audit storage fails after money movement, the preparation record remains and the transaction is still persisted; a structured error is logged rather than pretending no payment occurred. The transaction also initially stores initiation/request ID metadata, but the independent audit is the durable lookup.

The first preparation's channel is retained for client retries with the same idempotency key. Changed payment data or changed wallet initiation requirements under that key are rejected. Automatic HTTP retries reuse the same complete serialized body. A previously persisted transfer returns its existing ID without another provider call. Concurrent requests with the same key still rely on Bridge's idempotency protection; this change does not introduce a general cross-request payment lock.

## Validation

The new HTTP runtime suite invokes the actual authorization endpoint, transfer endpoint and provider serializer with fake transports. It covers EURC/USDC and desktop/iPhone/Android request contexts; PIN/TOTP ordering; wallet lookup, identity and flag failures before consumption; invalid, expired, reused and payload-mismatched authorizations; pre-send audit failure; write-only field omission without an EEA exemption; automatic and client retries; provider-required scope conflicts; and preservation of accepted transfers when acceptance-audit storage fails. The existing non-EEA USDT/Tron test remains enabled.

No new transfer, historical SCA evidence or customer balance is created or changed during these tests. Historical transfer `d4d6d19b-b48f-4649-8a6e-95a4dab8b4fc` predates these new audit records; this release cannot create retrospective evidence of its outgoing initiation.

## Production verification after a user-authorized payout

```sql
SELECT action_type, timestamp, target_resource AS bridge_transfer_id,
       after_state->>'bridge_request_id' AS bridge_request_id,
       after_state->>'wallet_initiation_required' AS initiation_required,
       after_state->'initiation' AS initiation_sent,
       after_state->>'sca_authorization_id' AS authorization_id,
       request_id AS idempotency_key
FROM public.admin_action_audit
WHERE action_type = 'bridge_transfer_initiation_accepted'
ORDER BY timestamp DESC
LIMIT 10;
```

Deploy `bridge-transfer` from the merged commit. Its shared provider/helper bundle contains this change. There is no database migration or frontend release required. Verify the deployed bundle/version and authenticated user payout evidence separately; deployment success is not a live payout test.
