import {
  knowledgeSources,
  retrieveSupportKnowledge,
  SUPPORT_KNOWLEDGE,
  SUPPORT_KNOWLEDGE_VERSION,
} from "../supabase/functions/_shared/support-knowledge-base.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("support knowledge is versioned and provider neutral", () => {
  assert(/^\d{4}-\d{2}-\d{2}\.\d+$/.test(SUPPORT_KNOWLEDGE_VERSION), "invalid version");
  assert(SUPPORT_KNOWLEDGE.length >= 15, "knowledge base is incomplete");
  const publicText = JSON.stringify(SUPPORT_KNOWLEDGE).toLowerCase();
  for (const forbidden of ["bridge.xyz", "yellow card", "flutterwave", "brevo"]) {
    assert(!publicText.includes(forbidden), `provider leaked: ${forbidden}`);
  }
});

Deno.test("maintenance questions retrieve the current business price", () => {
  const matches = retrieveSupportKnowledge("What is the monthly maintenance fee?");
  assert(matches[0]?.id === "business-maintenance", "maintenance answer not ranked first");
  assert(matches[0].answer.includes("USD 29.99"), "current price missing");
});

Deno.test("country identification questions receive an exact regional answer", () => {
  const zambia = retrieveSupportKnowledge("Which tax identification number is required in Zambia?");
  assert(zambia[0]?.id === "business-identification-zambia", "Zambia lookup missing");
  assert(zambia[0].answer.includes("TPIN"), "Zambia TPIN missing");

  const uk = retrieveSupportKnowledge("What company registration number is accepted in the UK?");
  assert(uk[0]?.id === "business-identification-united-kingdom", "UK alias lookup missing");
  assert(uk[0].answer.includes("CRN"), "UK CRN missing");
});

Deno.test("unsupported questions do not receive invented answers", () => {
  assert(retrieveSupportKnowledge("Tell me tomorrow's football score").length === 0, "unrelated query matched");
});

Deno.test("citations are deduplicated", () => {
  const matches = retrieveSupportKnowledge("How do I receive USD and what are the fees?");
  const sources = knowledgeSources(matches);
  assert(new Set(sources).size === sources.length, "duplicate sources returned");
  assert(sources.every((source) => source.startsWith("https://www.borderpayafrica.com/")), "unapproved source returned");
});
