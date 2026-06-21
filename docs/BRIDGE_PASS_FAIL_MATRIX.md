# Bridge Validation PASS / FAIL Matrix (Phase 3A)

Date: 2026-06-20
Basis: Bridge documentation validation + previously collected live evidence.

| Gate Item | Status | Why |
|---|---|---|
| Funding Gate alignment to Bridge capabilities | FAIL | BorderPay rule is stricter than Bridge and currently implemented with mixed-balance + synthetic FX logic. |
| Wallet auto provisioning lifecycle | FAIL | Bridge requires explicit wallet creation API call; current runtime does not guarantee auto-provision on KYC/KYB approval. |
| Bridge customer linkage integrity | FAIL | Canonical sequence requires persisted `customer_id` before downstream flows; live evidence showed approved rows without linkage. |
| Transfer state mapping completeness | FAIL | Current mapping does not cover full Bridge transfer state set. |
| Webhook category coverage | FAIL | Required `bridge_wallet.activity` is not explicitly mapped in runtime router. |
| Stablecoin wallet model alignment | FAIL | Projection/gating logic not consistently chain+asset aware end-to-end. |
| Virtual account lifecycle invariants | PARTIAL | Core Bridge precondition (KYC/KYB approved) exists; funding and sequencing invariants are not consistently enforced. |
| Signature verification and replay protection | PASS | Implemented and aligned to Bridge webhook signature guidance. |
| Atomic ingest and duplicate event suppression | PASS | Ingest design supports atomic persistence/queue semantics and duplicate handling. |
| Unknown event fail-safe handling | PASS | Unknown events are completed safely without business side effects. |

## Gate Verdict

Overall: **FAIL**

BorderPay is not yet aligned enough with Bridge-documented lifecycle and financial invariants to safely process production customer money.

