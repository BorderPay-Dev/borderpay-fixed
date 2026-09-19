# Invoice Hub v2.4 — controlled release

## Implemented source
Merchant invoice builder, agreement selection, branding/signature capture, conditional evidence uploads, authenticated private upload/download endpoints, review queue, OCR and Azure review adapters, manual field verification, invoice revision snapshots, private RFI dossiers, and approved buyer payment PDFs.

The initial runtime receiving-account adapter reads Bridge. Conduit/Borderless permissions and environment checks are prepared as a shared contract; these providers are not active runtime adapters in this release.

## Required configuration
- AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT_NAME, AZURE_OPENAI_API_VERSION (existing project values).
- AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY for OCR.
- PREDEPOSIT_WORKER_TOKEN: a random secret of at least 32 characters. It is never sent to a merchant or included in an app bundle.
- Approved agreement template version and compliance-owned jurisdiction/structuring policy. Proposed terms are seeded as a draft.
- Private predeposit-render-assets/NotoSans-Regular.ttf. SHA-256: b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5. Source: https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf (SIL Open Font License).

## Apply reviewed SQL
Apply 20260920010000_predeposit_evidence_foundation.sql, then 20260920020000_predeposit_workflow.sql 20260920030000_predeposit_draft_agreement.sql, then 20260920040000_predeposit_instruction_read_boundary.sql. The final migration adds restrictive instruction-read policies. With mode disabled/observe, legacy bank reads remain unchanged; with enforce, business VA coordinates are gated while crypto balance reads remain available.

Deploy predeposit-hub and predeposit-worker from the tested commit. Neither endpoint initiates a transfer or creates/deactivates a receiving account.

Keep predeposit_policy.mode='disabled' until the coordinated instruction-read rollout below is complete. hub_enabled is a separate feature switch for the new hub only.

## Durable worker schedule
Invoke predeposit-worker once per minute with POST and X-Predeposit-Worker-Token from a server scheduler. It claims at most four jobs per invocation using five-minute leases. A job waiting for OCR resumes after 30 seconds. Thirty unsuccessful claims route to manual review. Never embed this token in frontend code.

The database queue is durable; waitUntil is only a prompt first attempt. Without the server schedule, returning to the invoice also resumes processing, but unattended processing is not guaranteed.

## Required acceptance checks before merchant rollout
1. An approved business lists only its active receiving account labels; another user's account/evidence is rejected.
2. Generated agreement uses an approved immutable template and a per-invoice signature authorization.
3. Custom contract OCR, order proof, physical-goods evidence and manual review are exercised with representative redacted documents.
4. Buyer export contains the invoice and contract. CRM/source-of-funds evidence and internal assessment remain only in the private compliance dossier.
5. GBP company/company, current VA eligibility, account binding, evidence hashes, approval expiry and existing financial-read SCA are checked again at export.
6. Worker schedule and failure/timeout handling are verified against configured Azure services.
7. Native file picking, signature capture and PDF sharing are tested in TestFlight/Android internal track before store review.

## Coordinated instruction-read release
Inventory found direct reads from bridge_virtual_accounts and fiat rows in wallets, account-letter references, virtual-account public-api-gateway, and security-definer partner/white-label workspace RPCs. Existing frontend financial snapshots also cache bank coordinates.

Source changes cover restrictive direct-read policies, account-detail UI, receive navigation, provisioning responses, account-sync responses, and API idempotency replays. Inspected partner/white-label workspace RPCs return VA labels/last4 rather than full coordinates. The live bridge-virtual-account provisioning graph differs substantially from the branch and remains an unresolved read boundary; do not enable enforcement before integrating its instruction filter without rolling back the live enrollment and routing protections. Deploy all affected endpoints from a tested commit, verify against live sources to avoid rollback, and repeat the production read-surface audit before enforcement. Legacy clients need a supported upgrade path; old downloaded bank instructions cannot be recalled by UI gating. Signed provider deposit events must be reconciled with the exact incoming amount/currency/remitter and escalated when unmatched.

Never enable enforcement by changing one flag while these reads still disclose instructions. Persistent external bank instructions and direct crypto deposits cannot be prevented by a UI gate. Unmatched incoming deposits must remain subject to monitoring and review.
