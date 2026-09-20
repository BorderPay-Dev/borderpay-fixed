# Automatic document checks

review_mode=automatic removes blanket operator approval for clean assessments. Unresolved checks return action_required with merchant corrections. Failed OCR, AI outages, mismatched data, unverified execution and evidence cannot become approved. Original findings, document hashes and verification records remain unchanged. Existing clients receive server-provided explanations.

The optional hub stays in observe mode. Bank reads, payments, KYC/KYB and provider compliance controls are not changed. AI output is document analysis, not certification of authenticity. Uploaded contracts without independent execution verification remain flagged. The current hub compares documents against an invoice entered in BorderPay; it does not import a standalone merchant invoice PDF.

Deploy predeposit-hub and predeposit-worker from the tested commit, run the synthetic Azure acceptance probe, then apply the automatic review migration. Verify mode=observe and review_mode=automatic. No customer invoice or payment is created by the probe.
