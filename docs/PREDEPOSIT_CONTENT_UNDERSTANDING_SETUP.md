# Azure Content Understanding for pre-deposit evidence

Content Understanding can replace Document Intelligence for OCR without changing the invoice rules or enabling the gate. Use the GA API version 2025-11-01 with prebuilt-layout. The adapter uploads private bytes directly, polls only the same Azure resource, and retains document SHA-256 and word confidence. Missing OCR details, service failures, and malformed results go to review. It requests processingLocation=geography rather than Azure's global default.

## Resource setup
1. Open Content Understanding in Foundry. Connect a Foundry resource in a supported region.
2. Test OCR/Read using a synthetic PDF. Open Code and verify the resource endpoint.
3. The backend uses prebuilt-layout, which does not need a separate generative-model deployment. Existing GPT-4o remains responsible for semantic screening.
4. In Supabase Vault, add:
   - borderpay_predeposit_ocr_provider = content_understanding
   - borderpay_content_understanding_endpoint = the HTTPS resource root (no /api/projects or deployment path)
   - borderpay_content_understanding_key = the resource key
   Keep credentials out of chat, source control, SQL history and screenshots. No additional Edge secrets are required.
5. Apply migration 20260920070000 and deploy the tested hub/worker graph.
6. Run a synthetic PDF and CRM screenshot through the worker, verify citations and confidence, and test mismatched amounts/names, missing evidence and service failure. Existing jobs are bound to their original OCR provider; switching providers does not reinterpret them.
7. Keep predeposit_policy.mode=disabled and hub_enabled=false until read boundaries, contract/risk configuration and acceptance checks are complete.

The Studio alone does not prove the API key, region or service deployment is ready. OCR does not authenticate signatures, commercial relationships or document provenance. Do not activate the mandatory gate based only on a successful extraction.

References checked 2026-09-20:
- https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/overview
- https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/concepts/prebuilt-analyzers
- https://learn.microsoft.com/en-us/rest/api/contentunderstanding/content-analyzers/analyze?view=rest-contentunderstanding-2025-11-01
- https://learn.microsoft.com/en-us/rest/api/contentunderstanding/content-analyzers/get-result?view=rest-contentunderstanding-2025-11-01
