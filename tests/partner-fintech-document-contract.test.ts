function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const functionSource = await Deno.readTextFile(
  new URL("../supabase/functions/partner-onboarding/index.ts", import.meta.url),
);
const migration = await Deno.readTextFile(
  new URL("../supabase/migrations/20260907234500_partner_fintech_document_categories.sql", import.meta.url),
);

Deno.test("supplemental fintech evidence remains accepted but optional", () => {
  for (const documentType of ["tax_registration", "company_bylaws"]) {
    assert(!functionSource.includes(`["${documentType}",`), `${documentType} must not block submission`);
    assert(migration.includes(`'${documentType}'`), `${documentType} must be accepted by the database`);
  }
  assert(migration.includes("'good_standing'"), "good-standing evidence must be available when applicable");
  assert(
    functionSource.includes('organization?.kyb_source !== "bridge_verified"'),
    "Bridge-verified entities must retain their documented reduced-evidence path",
  );
});
