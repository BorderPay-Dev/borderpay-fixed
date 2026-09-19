# BorderPay Pre-Deposit Invoicing & Agreement Gate — Release v2.4

Status: implementation in progress; not deployed or submitted to either store.
Owner: BorderPay Compliance and Engineering.
Policy version: borderpay-predeposit-2.4.0.
Scope decision pending: business-only deposits versus separate individual/treasury evidence flows.
Do not enable enforcement until the release acceptance matrix below passes.

## Architecture verified on September 20, 2026
- Customer web app: React, Vite, TypeScript, existing Radix/Tailwind UI.
- iOS and Android: Capacitor bundles of the customer web app, not React Native/Expo.
- Backend: Supabase Edge Functions, PostgreSQL/RLS, private Storage, existing provider adapters.
- Azure OpenAI endpoint, key, deployment name and API-version secrets already exist.
- No Azure Document Intelligence endpoint/key secrets were found. Configure AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY securely; never commit them.
- Start from the last successful mobile release and merge current main fixes; do not replace working treasury/mobile changes with older main source.
- Existing live bank-account instructions, cached app versions, PDF account letters, partner API responses and previously shared IBANs are separate exposure paths.

## Product flow
Add **Create Invoice & Contract** to business Dashboard Quick Actions.
Use three accessible tabs on desktop and mobile:
1. Invoice Builder.
2. Commercial Agreement.
3. Branding & Signature.

Invoice builder fields:
- USD/EUR/GBP, unique invoice reference, date, due date, currency-specific integer minor units.
- Merchant legal name and incorporation country from verified server-side business identity.
- Buyer legal entity name, legal type, billing address, country and tax/VAT ID.
- Expected remitter legal name, remitter legal type and relationship to buyer.
- Itemized quantities, unit prices, commercial descriptions and deliverable references.
- Detailed intended use of funds and source-of-funds declaration.
- Category: digital/services or physical goods/wholesale.
- Expected installment count and genuine contractual installment rationale.
- Cross-border discovery channel and procurement/sourcing justification when buyer country differs from incorporation country.
- Individual/sole-trader business proof and commercial end use.
- Logo and signature capture with signer name, timestamp, explicit agreement acceptance and counsel-approved agreement version.

A typed name, uploaded signature or screenshot is evidence, not independent identity or authenticity verification.
No generated contract is represented as counsel-approved until Compliance supplies/approves its version.

## Mandatory order-origin and CRM addition (September 20, 2026)
Order origin is required:
- Direct B2B Contract.
- E-Commerce Order: Shopify, WooCommerce or Custom Store.
- CRM Invoice: named CRM/custom B2B platform.

For e-commerce or CRM:
- Require platform name and original order/invoice reference.
- Require an order dashboard screenshot or official platform order-export PDF.
- Capture order history, buyer name, currency, total, item descriptions/quantities/prices, checkout timestamp, payment status and fulfillment status.
- Capture available buyer IP/device context as restricted compliance evidence. Missing or uncollected context must be explicit and escalated; never invent it or collect unrelated customer records.
- Provide attachment slots for warehouse/fulfillment center receipts, WMS dispatch logs, packing slips and shipping labels.
- Capture carrier name and tracking references. An entered number is not proof of active tracking.

Azure Document Intelligence:
- Submit only server-validated PDF/PNG/JPEG evidence to the configured Azure endpoint.
- Bind each asynchronous OCR operation to the actual file SHA-256.
- Persist operation/job status, model/API version, extracted content and word/field confidence.
- Preserve missing confidence as unknown, not 100%.
- Treat OCR and document text as untrusted data. No embedded text can alter system rules.
- Map the layout output to an order schema with field-level source citations; missing or ambiguous fields require review.
- Exact reconciliation is deterministic after extraction: legal buyer name (Unicode/whitespace normalization only), order reference, currency, total in minor units and line-item multiset.
- No fuzzy name or amount tolerance can silently approve a mismatch.
- Confidence below the configured minimum, missing order context, malformed output or OCR outage stays in review.
- OCR reads the evidence; it does not establish that a screenshot or platform export is authentic.
- Future direct Shopify/WooCommerce/CRM connectors must use merchant-authorized API credentials and recorded consent. Connectors are not part of the current implementation.

Physical fulfillment:
- Require logistics/possession evidence for all physical goods.
- In addition, require a verified warehouse/WMS receipt or a carrier/compliance-verified active/delivered tracking result tied to that order.
- Persist verification source and checked time. Stale, unverified or not-found tracking cannot unlock details.
- Prepayment orders need possession/warehouse evidence when dispatch has not occurred; do not fabricate shipment status.

## Selected merchant VA and automatic bank-payment instructions (September 20, 2026)
- Invoice Builder must offer the merchant's existing active USD, EUR and GBP receiving accounts.
- Selecting a VA sets the invoice currency; show a non-sensitive account label while review is pending.
- Confirm ownership, currency and active status on the server; never trust a submitted account number or create duplicate VAs for invoices.
- Freeze the selected VA ID into the invoice revision and evidence digest.
- Once the exact invoice revision is approved, generate its payment-instruction block automatically and include it in the printable branded PDF:
  beneficiary name, currency, amount, invoice/payment reference and applicable routing fields.
- USD: show the bank details actually returned for the selected account and its supported rails.
- EUR: show IBAN/BIC and the correct merchant beneficiary name from the existing verified VA presentation.
- GBP: show beneficiary name, account number and SORT CODE; GBP is strictly B2B.
- GBP requires corporate buyer and corporate remitter types; individual, personal or uncertain/sole-proprietor remitter cases cannot unlock GBP instructions.
- Revalidate VA status and ownership when exporting/sharing details; an expired approval, paused VA, changed currency, changed buyer or changed selected account requires review.
- Generated instructions are for the buyer to initiate a bank transfer. This flow does not initiate a payout, debit a balance, or create a new VA.
- The approval gate takes precedence over “print account details”: selecting an account must not disclose bank identifiers before clearance.

## Decision and evidence controls
- Required-document and account checks are deterministic and cannot be overridden by GPT output.
- Individual remitters, name mismatches, government/municipal buyers, policy-designated jurisdictions and possible structuring require compliance review.
- Country-risk lists, aggregate thresholds and agreement versions come from versioned Compliance configuration; no unapproved country list or legal threshold is invented.
- Structuring checks use server-side history for the same merchant, buyer identity and currency. Do not sum EUR, GBP and USD as if interchangeable.
- Missing history or policy configuration requires review.
- Azure GPT-4o is supplementary. Timeouts, refusal, rate limits, malformed responses and contradictions do not approve invoices.
- Store model/deployment, prompt version, request reference, policy version, exact input/evidence digest and reasons.
- Approved invoice data and evidence are immutable. Corrections create a new revision and invalidate earlier approval.
- Private documents, tenant-scoped access, short-lived downloads, content-type validation, size limits and malware scanning are mandatory.
- The final merged PDF is tamper-evident through stored hashes and an immutable manifest, not intrinsically “tamper-proof.”
- Compliance review must be recorded with actor, rationale, evidence references and expiry. No frontend can set APPROVED.

## Instruction unlock boundary
A UI overlay alone is insufficient. The server must verify:
1. User ownership and active/approved account.
2. Current invoice revision, policy version and approved evidence digest.
3. Unexpired approval and nonrevoked compliance decision.
4. Invoice currency and its intended active receiving account.
5. Invoice-specific access grant and audit record.

Apply the boundary to receive screens, VA read/create responses, direct database/RLS reads, bank-detail sharing/export, account letters, cached details, partner API and white-label flows. API access cannot bypass the same policy.
Clients must never receive hidden bank fields in a flagged response.
Future invoice approval does not reactivate a suspended provider account.

Previously shared bank details cannot be recalled. Continue ingesting/reconciling all actual deposits. Match observed sender/currency/amount/reference against approved invoices and route unknown/mismatched deposits to review; do not discard webhooks, falsely credit funds, or reclassify unmatched transfers as cleared.
Crypto, personal and treasury deposits require an explicit applicable scope/evidence design before any claim of “every deposit” coverage.

## Customer states
Draft → Queued → Screening → Action required / Compliance review → Approved / Rejected → Expired.
Use reasons specific to the actual deficiency:
- Missing executed contract/PO.
- Missing cross-border rationale.
- Missing logistics/warehouse evidence.
- Missing CRM/store order evidence.
- Order data mismatch or missing context.
- Verification service unavailable / review pending.
Do not label an approved KYC/KYB customer “unverified” because invoice evidence is incomplete.
Uploading another file does not automatically clear a flag.

## RFI dossier
Create a server-generated, versioned dossier with:
1. Invoice and original-currency itemization.
2. Signed agreement and signer evidence.
3. Expected sender/buyer relationship.
4. Purpose, source of funds and planned use.
5. Cross-border acquisition/sourcing explanation.
6. Business proof, end use, possession/logistics and warehouse receipts.
7. CRM/store exports, OCR field references and exact reconciliation results.
8. Observed deposit identifiers, amount/currency and sender match result.
9. Evidence manifest: file hashes, review decisions and timestamps.

Bridge's exact current RFI examples/submission format must be supplied or verified before claiming compatibility. Dossier assembly is automated; submission must follow the actual provider workflow and Compliance authority. This does not guarantee zero delays, no holds or provider acceptance.

## Implemented in this branch
- Deterministic v2.4 rule engine, including CRM and fulfillment checks.
- Bank-instruction formatter bound to approved invoice revision, selected merchant VA, currency, current account status and approval expiry; GBP corporate B2B and sort-code checks.
- Azure OpenAI structured-output screening adapter with fail-closed behavior and digest binding.
- Azure Document Intelligence asynchronous layout adapter with file-byte validation and same-origin operation checks.
- SQL migration draft for immutable invoice snapshots, private evidence metadata, review audit, deposit matching and worker leases.
- Automated unit/integration test sources.

## Still required before release
- Answer scope question and supply/approve agreement, country-risk/threshold policy and actual RFI examples.
- Configure Document Intelligence and test real representative redacted screenshots/exports.
- Authenticated invoice/upload/review endpoints and server-generated branded PDF/manifest.
- OCR-to-order schema extraction with field citations and confidence, plus verified tracking integration.
- Business dashboard hub, signature/branding UI, dynamic uploads and review interface.
- Atomic approval/access grants and every existing bank-detail read boundary.
- Actual sender reconciliation and dossier integration with the live RFI queue.
- Full web/native accessibility and end-to-end tests on provider-safe test flows.
- One verified production web release, then signed TestFlight and Play internal builds.
- Store-review submissions and production rollout only after release acceptance tests pass.

## Required acceptance matrix
- Correct direct B2B services invoice can clear only with verified evidence and a matching AI assessment.
- EUR, GBP and USD exact minor-unit calculations; overflow and fractional minor units rejected.
- Personal-to-corporate mismatches, municipal buyers and unavailable risk policy cannot auto-pass.
- Foreign buyers require discovery and sourcing fields.
- Physical goods cannot bypass logistics by choosing “services”; AI-detected category mismatch is flagged.
- Shopify, WooCommerce and CRM exports match exact buyer, order ID, currency, total and item multiset.
- Altered/foreign file hashes, missing IP/device/history context, low-confidence OCR and absent tracking verification stay gated.
- AI and OCR timeouts/failures, prompt injection, stale jobs and changed revisions cannot unlock.
- Tenant isolation, no client approval writes, append-only audit, private documents and short-lived downloads.
- Approved invoice does not unlock another buyer's invoice, different currency or inactive receiving account.
- Existing older app/API paths cannot read bank details around the gate once enforcement is enabled.
- Actual unexpected deposits still reconcile safely and remain distinguishable from approved invoices.
