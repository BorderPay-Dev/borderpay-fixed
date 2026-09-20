# Automatic document checks

review_mode=automatic removes blanket operator approval for clean assessments. Unresolved checks return action_required with merchant corrections. Failed OCR, AI outages, mismatched data, unverified execution and evidence cannot become approved. Original findings, document hashes and verification records remain unchanged. Existing clients receive server-provided explanations.

The optional hub stays in observe mode. Bank reads, payments, KYC/KYB and provider compliance controls are not changed. AI output is document analysis, not certification of authenticity. Uploaded contracts without independent execution verification remain flagged. The current hub compares documents against an invoice entered in BorderPay; it does not import a standalone merchant invoice PDF.

Deploy predeposit-hub and predeposit-worker from the tested commit, run the synthetic Azure acceptance probe, then apply the automatic review migration. Verify mode=observe and review_mode=automatic. No customer invoice or payment is created by the probe.

The live launch config has no jurisdiction policy or numerical structuring thresholds. Explicit review_scope=document_checks in observe mode records those checks as not performed instead of inventing rules or treating absent configuration as bad paperwork. Available history still reaches Azure. Original strict findings are retained. A database constraint prevents this scope from being used in enforce mode; changing scope also changes the policy-config digest. Evidence provenance and signature execution remain required and cannot be bypassed by this scope.
