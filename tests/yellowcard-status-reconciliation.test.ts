const source = await Deno.readTextFile(
  new URL("../components/receive/ReceiveMoneyScreen.tsx", import.meta.url),
);

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("Yellow Card Receive reconciles a created collection without resubmitting it", () => {
  const start = source.indexOf("const refreshAfricanCollectionStatus = async");
  const end = source.indexOf("const createAfricanCollection = async", start);
  assert(start >= 0 && end > start, "status reconciliation function is missing");
  const block = source.slice(start, end);

  assert(block.includes("action: 'status'"), "reconciliation must use the read-through status action");
  assert(block.includes("sequence_id: sequenceId"), "reconciliation must reuse the original sequence ID");
  assert(block.includes("const attempts = poll ? 8 : 1"), "automatic polling must be bounded");
  assert(block.includes("setTimeout(resolve, 2_500)"), "bounded polling interval is missing");
  assert(!block.includes("action: 'create_receive'"), "status recovery must never resubmit the collection");
});

Deno.test("Yellow Card Receive exposes a retryable delayed-status state", () => {
  assert(source.includes("setCollectionStatusDelayed(true)"), "failed or exhausted polling must be visible");
  assert(source.includes("Status update delayed"), "delayed status copy is missing");
  assert(source.includes("Retry status check"), "manual status retry control is missing");
  assert(source.includes("void refreshAfricanCollectionStatus(true)"), "created collections must start reconciliation");
});
