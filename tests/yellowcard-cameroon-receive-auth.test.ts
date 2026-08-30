function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

const source = await Deno.readTextFile(
  new URL("../components/receive/ReceiveMoneyScreen.tsx", import.meta.url),
);

Deno.test("Cameroon receive PIN authorization submits only once and shows progress", () => {
  assert(source.includes("if (collectionAuthorizationRef.current) return;"));
  assert(source.includes("collectionAuthorizationRef.current = true;"));
  assert(source.includes("collectionAuthorizationRef.current = false;"));
  assert(source.includes("setReceiveStep('africa-processing');"));
  assert(source.includes("receiveStep === 'africa-processing'"));
  assert(source.includes('Processing collection…'));
  assert(/<InputOTP[^>]+disabled=\{collectionLoading\}/.test(source));
  assert(source.includes("Authorizing and submitting securely…"));
  assert(source.includes("if (collectionAuthorizationRef.current) return;"));
});

Deno.test("African receive submits once and retains its sequence until explicit reset", () => {
  assert(!source.includes("action: 'preflight',"), "receive must not repeat provider discovery before create");
  assert(source.includes("action: 'create_receive',"));
  const resetStart = source.indexOf("const resetAfricanReceiveFlow = () => {");
  const createStart = source.indexOf("const createAfricanCollection = async () => {");
  assert(resetStart >= 0 && createStart > resetStart);
  const resetSource = source.slice(resetStart, createStart);
  const createEnd = source.indexOf("const authorizeCollectionWithPin", createStart);
  const createSource = source.slice(createStart, createEnd);
  assert(resetSource.includes("collectionSequenceRef.current = null;"));
  assert(!createSource.includes("collectionSequenceRef.current = null;"), "a successful response must retain the idempotency sequence");
});
