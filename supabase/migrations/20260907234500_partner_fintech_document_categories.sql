-- Extend partner KYB evidence categories for jurisdiction-neutral fintech
-- formation and tax documents. Validation is activated with the matching
-- partner-onboarding deployment only after the portal upload UI is live.
begin;

alter table public.partner_application_documents
  drop constraint if exists partner_application_documents_document_type_check;

alter table public.partner_application_documents
  add constraint partner_application_documents_document_type_check check (document_type in (
    'certificate_of_incorporation','articles_of_association','tax_registration',
    'company_bylaws','good_standing','register_of_directors',
    'register_of_shareholders','ownership_chart','proof_of_registered_address',
    'ubo_identity','ubo_address','director_identity','operating_licence','aml_policy',
    'sanctions_policy','privacy_policy','security_policy','incident_response_policy',
    'financial_statement','bank_statement','source_of_funds','nda','other'
  ));

commit;
