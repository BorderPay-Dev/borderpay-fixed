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
  assert(/<InputOTP[^>]+disabled=\{collectionLoading\}/.test(source));
  assert(source.includes("Authorizing and submitting securely…"));
});
