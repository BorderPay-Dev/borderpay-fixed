# Consumer agreement drafts
The invoice builder supports B2B, D2C (own-brand direct sales to consumers), and B2C (retail/services to consumers). Legacy drafts default to B2B.

Consumer buyers are individuals purchasing for non-business use. They do not require business registration solely because they are consumers. Payer mismatches, evidence, logistics, AML checks and provider eligibility remain enforced. GBP is strictly corporate-to-corporate B2B in server-side exports and payment instructions.

The two new standard versions are seeded as draft, not approved. Merchants can select them, fill delivery, cancellation/return, support and charge disclosures, then download an invoice with an unsigned draft agreement attached. Drafts never receive the merchant signature or become verified agreement evidence. Existing approved B2B versions are unchanged.

Before production execution, an authorized admin uses the existing template approval action to review/adapt the terms (including removing draft-only wording), assign the correct agreement_type, and approve a version. Approved versions remain immutable. Consumer terms must preserve applicable mandatory rights; template selection does not expand a receiving account's supported payer types.

Migration: 20260923020000_predeposit_consumer_agreements.sql.
Deploy predeposit-hub and predeposit-worker with their updated shared modules, then the web release. Bundled native apps need a future build; store listing metadata is unchanged.
