# Existing-merchant invoicing in observation mode

The invoice hub is a commercial-document tool while policy mode is `observe`. An authenticated business can save billing details and download an invoice with its selected live, active receiving account without waiting for invoice approval. Bank account selection, financial-access/SCA checks, ownership, provider eligibility and GBP corporate-to-corporate requirements still apply. No provider account or transfer is created by invoice export.

Download invoice does not assert compliance approval. Supporting documents can be submitted through Check invoice & documents; the private dossier is separate from the buyer-facing invoice. Existing bank details shared outside BorderPay cannot be revoked by hiding them in the app.

In `enforce` mode, this download path provides billing only; approved payment exports continue through the existing approval, binding and expiry checks. Invoicing is optional for all merchants, including new businesses. Do not enable mandatory gating as part of this rollout. This change does not enable enforcement or change the risk policy.

Invoice copies are regenerated from owner-scoped saved drafts or immutable submitted revisions, with server-side seller and bank data, private storage and short-lived authenticated downloads. Customer copies omit internal commercial-risk declarations and supporting evidence.

The hub is optional for every merchant, including newly approved businesses. Approval and activation emails introduce it as a document-preparation tool. Business broadcasts offer the same guidance; no campaign is sent automatically by this release. Publish the customer UI before deploying the email templates. Retain the existing banking review/request process.

Invoice export can include a selected custom contract or a generated agreement when an approved template, saved signature and per-invoice signature consent are present. This is not an invoice-approval requirement. Rejected evidence is not included. Only commercial contracts are appended to the buyer PDF; CRM, source-of-funds, logistics records and internal assessments stay private.
