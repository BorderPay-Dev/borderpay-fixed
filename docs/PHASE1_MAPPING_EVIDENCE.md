# PHASE1_MAPPING_EVIDENCE

Date: 2026-06-20  
Source: Live production read-only SQL evidence

## Affected entities (approved + missing `bridge_customer_id`)

| internal_id | profile_type | email | full_name | link_id | verification_status |
|---|---|---|---|---|---|
| `6ab47d98-1855-4f6e-afb2-15dfa46c79d1` | business | `demo.business@borderpayafrica.com` | `Demo Holdings Ltd` | `NULL` | approved |
| `6ab47d98-1855-4f6e-afb2-15dfa46c79d1` | individual | `demo.business@borderpayafrica.com` | `Demo Business Owner` | `NULL` | approved |
| `a4b3fccf-ac76-41f1-9727-432feffd8dac` | individual | `demo.individual@borderpayafrica.com` | `Demo Individual` | `NULL` | approved |

## Deterministic matching evidence per affected row

Accepted deterministic keys tested:

- exact email in webhook payload (`event_object.email`)
- exact email in pending-event payload
- exact `bridge_kyc_link_id` / `bridge_kyb_link_id` to `kyc_link.*` events
- exact `client_reference_id == internal_id`
- exact local projection linkage in `bridge_wallets` / `bridge_virtual_accounts`

### Row 1

- Internal ID: `6ab47d98-1855-4f6e-afb2-15dfa46c79d1`
- Profile type: `business`
- Email: `demo.business@borderpayafrica.com`
- Bridge customer candidate(s): none
- Matching criteria: no exact hit across all deterministic keys above
- Confidence score: `0.00`
- Deterministic?: `NO`

### Row 2

- Internal ID: `6ab47d98-1855-4f6e-afb2-15dfa46c79d1`
- Profile type: `individual`
- Email: `demo.business@borderpayafrica.com`
- Bridge customer candidate(s): none
- Matching criteria: no exact hit across all deterministic keys above
- Confidence score: `0.00`
- Deterministic?: `NO`

### Row 3

- Internal ID: `a4b3fccf-ac76-41f1-9727-432feffd8dac`
- Profile type: `individual`
- Email: `demo.individual@borderpayafrica.com`
- Bridge customer candidate(s): none
- Matching criteria: no exact hit across all deterministic keys above
- Confidence score: `0.00`
- Deterministic?: `NO`

## Category classification

### Category A - Deterministic mapping (safe automated repair)

None.

### Category B - Multiple candidate mappings (manual review)

None.

### Category C - No Bridge customer exists / no deterministic mapping

- `6ab47d98-1855-4f6e-afb2-15dfa46c79d1` (business profile row)
- `6ab47d98-1855-4f6e-afb2-15dfa46c79d1` (individual profile row)
- `a4b3fccf-ac76-41f1-9727-432feffd8dac` (individual profile row)

## Evidence snapshots

1. Exact-email candidate mapping from webhooks

All affected rows returned `bridge_customer_id = NULL`.

2. Exact-email candidate mapping from pending events

All affected rows returned `bridge_customer_id = NULL`.

3. Link-id mapping (`bridge_kyc_link_id` / `bridge_kyb_link_id`)

All affected rows had `link_id = NULL`, no candidate.

4. `client_reference_id == internal_id`

All affected rows had no candidate.

5. Projection-based mapping (`bridge_wallets` / `bridge_virtual_accounts`)

All affected rows had no candidate.

6. Additional integrity signals

- Duplicate ownership count: `0`
- Conflicting ownership count: `0`
- Orphan webhook-observed Bridge customers: `7`
- Duplicate emails in affected set: `demo.business@borderpayafrica.com (n=2)`

## Decision

**MANUAL REVIEW REQUIRED**

