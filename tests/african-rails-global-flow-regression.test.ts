function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

const send = await Deno.readTextFile(new URL("../components/send/SendMoneyFlow.tsx", import.meta.url));
const receive = await Deno.readTextFile(new URL("../components/receive/ReceiveMoneyScreen.tsx", import.meta.url));
const app = await Deno.readTextFile(new URL("../App.tsx", import.meta.url));
const lock = await Deno.readTextFile(new URL("../components/security/AppLockScreen.tsx", import.meta.url));
const sandboxTransaction = await Deno.readTextFile(new URL("../supabase/functions/yellowcard-sandbox-transaction/index.ts", import.meta.url));
const capabilities = await Deno.readTextFile(new URL("../supabase/functions/yellowcard-capabilities/index.ts", import.meta.url));

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

Deno.test("app unlock refreshes expired cached sessions before PIN verification", () => {
  assert(lock.includes("existing.split('.')[1]"));
  assert(lock.includes("Date.now() + 30_000"));
  assert(lock.includes("localStorage.removeItem('borderpay_token')"));
  assert(lock.includes("supabase.auth.refreshSession({ refresh_token: refreshToken })"));
  assert(lock.indexOf("Date.now() + 30_000") < lock.indexOf("PINManager.verifyAppUnlockPINResult"));
});

Deno.test("sandbox collection creation never waits on Bridge identity enrichment", () => {
  assert(sandboxTransaction.includes("if (!useSandboxIdentitySample && profile.bridge_customer_id"));
  assert(sandboxTransaction.indexOf("const useSandboxIdentitySample") < sandboxTransaction.indexOf("bridgeProvider.getCustomerProfile"));
  assert(sandboxTransaction.includes('idNumber: str(profile.id_number || bridgeIdentity?.id_number || (useSandboxIdentitySample ? "0123456789" : ""))'));
});

Deno.test("sandbox sends preserve dashboard data and receive enforces provider limits", () => {
  assert(send.includes("if (!isAfricanPayout) backendAPI.financial.invalidateForUser(userId);"));
  assert(send.includes("action: 'status'"));
  assert(send.includes("['failed', 'rejected', 'cancelled', 'canceled', 'expired']"));
  assert(receive.includes("collectionProviderMinimum !== null && amount < collectionProviderMinimum"));
  assert(receive.includes("Minimum amount is"));
});

Deno.test("send and receive render live Yellow Card minimum and maximum limits", () => {
  assert(capabilities.includes("minimum: row?.min ?? null"));
  assert(capabilities.includes("maximum: row?.max ?? null"));
  assert(capabilities.includes("channelIds:"));
  assert(send.includes("Minimum recipient amount is"));
  assert(send.includes("Maximum recipient amount is"));
  assert(send.includes("Allowed recipient amount:"));
  assert(send.includes("africanQuote?.destinationAmount"));
  assert(receive.includes("Allowed amount:"));
  assert(receive.includes("collectionProviderMaximum !== null && amount > collectionProviderMaximum"));
});
