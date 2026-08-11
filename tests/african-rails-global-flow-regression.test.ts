function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

const send = await Deno.readTextFile(new URL("../components/send/SendMoneyFlow.tsx", import.meta.url));
const app = await Deno.readTextFile(new URL("../App.tsx", import.meta.url));
const lock = await Deno.readTextFile(new URL("../components/security/AppLockScreen.tsx", import.meta.url));

Deno.test("African send performs one create call and retains its sequence across retries", () => {
  assert(!send.includes("action: 'preflight_send',"), "send must not repeat provider discovery");
  assert(send.includes("action: 'create_send',"));
  assert(send.includes("value.length === 6 && !transactionAuthorizationRef.current"));
  assert(send.includes("if (transactionAuthorizationRef.current) return;"));
  const successStart = send.indexOf("if (result.success) {");
  const pinStart = send.indexOf("const handlePinComplete", successStart);
  assert(successStart >= 0 && pinStart > successStart);
  assert(!send.slice(successStart, pinStart).includes("yellowCardSequenceRef.current = null;"));
  assert(send.includes("if (isAfricanPayout) yellowCardSequenceRef.current = null;"));
});

Deno.test("app unlock preserves the mounted screen behind a blocking overlay", () => {
  assert(app.includes("const showAppLock = appLocked && PINManager.hasPIN(user.id);"));
  assert(app.includes("visibility: 'hidden', pointerEvents: 'none'"));
  assert(app.indexOf("<MainApp") < app.indexOf("{showAppLock && ("));
  assert(lock.includes("fixed inset-0 z-[1000]"));
});
