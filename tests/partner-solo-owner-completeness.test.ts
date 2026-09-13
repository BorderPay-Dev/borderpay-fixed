function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`expected ${String(expected)}, received ${String(actual)}`);
}

const source = await Deno.readTextFile(
  new URL("../supabase/functions/partner-onboarding/index.ts", import.meta.url),
);

Deno.test("100 percent UBO satisfies solo director and controller roles", () => {
  assert(source.includes("const soleOwner = qualifyingUbos.length === 1"));
  assert(source.includes("Number(qualifyingUbos[0].ownership_percent) >= 99.99"));
  assert(source.includes('if (!soleOwner && !people.some((person) => person.person_type === "director"))'));
  assert(source.includes('if (!soleOwner && !people.some((person) => person.person_type === "controller"))'));
});

Deno.test("solo treatment does not waive UBO identity evidence", () => {
  assert(source.includes('if (people.some((person) => person.person_type === "ubo"))'));
  assert(source.includes('if (!docTypes.has("ubo_identity"))'));
  assert(source.includes('if (!docTypes.has("ubo_address"))'));
  assertEquals(source.includes("soleOwner && !docTypes.has"), false);
});
