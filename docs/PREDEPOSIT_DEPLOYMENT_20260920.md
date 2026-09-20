# Invoice Hub v2.4 — deployment record
Date: 2026-09-20

## Installed
- Supabase migrations 20260920010000 through 20260920060000.
- predeposit-hub v2 and predeposit-worker v2 deployed from tested commit 573267a95970ecb9b4b20d965aad3dead7641bfb.
- Private PDF font uploaded and SHA-256 read-back verified.
- Worker credential stored in Vault; service-role-only digest authorization.
- Scheduled queue dispatch once per minute (no request when the queue is empty).
- Live checks: hub without session 401; worker missing/wrong credential 401; correct worker credential 202 with zero jobs.
- Admin review released at admin.borderpayafrica.com, deployment dpl_9iKgZDtsxvYubKGPxSLcieJvjVJb, commit 928116d1700d7c354fa121810aa9dcf5e5bf7d28.

## Rollout state
predeposit_policy.mode=disabled; hub_enabled unset/false.
The merchant Quick Action is hidden while disabled. Existing financial access remains in force.
No transfer, receiving account, customer verification, or provider hold was changed by this installation.

## Pending release requirements
- Document Intelligence endpoint and key in Vault: borderpay_document_intelligence_endpoint and borderpay_document_intelligence_key. The project has reached the 100 Edge-secret limit; existing credentials were retained.
- Compliance approval of the draft agreement and versioned jurisdiction/structuring thresholds.
- Reconcile the live bridge-virtual-account provisioning graph before enabling the mandatory read boundary. It has enrollment, destination, status and fee differences from repository main.
- Signed incoming-deposit event matching and provider-specific RFI submission adapters.
- Conduit/Borderless live collection entitlement and verified customer bindings; neither is enabled for live invoice collection here.
- Native file-picker/signature/PDF testing and new store builds. No new mobile release was submitted.

## Verification
Cloud checks for c7d7d29cd204e8da0337a913de7ec36121437dd7 passed:
Pre-deposit compliance gate, Predeploy Gate, API Contract Pack, Safety Boundary Guard, Yellow Card Suite and Security Pipeline.
Includes policy/OCR/provider boundaries, existing customer API behavior, database access/immutability, durable worker dispatch, merchant desktop/mobile browser flow, generated PDFs, TypeScript and Vite build.
