-- Restore valid Auth logins after search_path hardening removed the schema
-- containing pgcrypto.digest() from this SECURITY DEFINER function.
-- Keep the path explicit and restricted; no user or credential data changes.

alter function public.certification_audit_append(
  text,
  text,
  text,
  text,
  text[],
  jsonb,
  jsonb,
  jsonb
)
set search_path = public, extensions, pg_temp;
