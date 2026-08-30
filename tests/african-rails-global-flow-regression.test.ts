function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

const send = await Deno.readTextFile(new URL("../components/send/SendMoneyFlow.tsx", import.meta.url));
const receive = await Deno.readTextFile(new URL("../components/receive/ReceiveMoneyScreen.tsx", import.meta.url));
const app = await Deno.readTextFile(new URL("../App.tsx", import.meta.url));
const lock = await Deno.readTextFile(new URL("../components/security/AppLockScreen.tsx", import.meta.url));
const capabilities = await Deno.readTextFile(new URL("../supabase/functions/yellowcard-capabilities/index.ts", import.meta.url));
const receiveEndpoint = await Deno.readTextFile(new URL("../supabase/functions/yellowcard-receive/index.ts", import.meta.url));
const payoutEndpoint = await Deno.readTextFile(new URL("../supabase/functions/yellowcard-jit-payout/index.ts", import.meta.url));
const accessGate = await Deno.readTextFile(new URL("../supabase/functions/_shared/african-rails-access.ts", import.meta.url));
const backend = await Deno.readTextFile(new URL("../utils/api/backendAPI.ts", import.meta.url));
const mainApp = await Deno.readTextFile(new URL("../components/app/MainApp.tsx", import.meta.url));

Deno.test("African send performs one idempotent JIT payout call", () => {
  assert(!send.includes("action: 'preflight_send',"), "send must not repeat provider discovery");
  assert(!send.includes("action: 'create_send',"), "mobile must not call the legacy direct Send action");
  assert(send.includes("backendAPI.payouts.yellowCardJitPayout"));
  assert(send.includes("transferIdempotencyKey"));
  assert(send.includes("if (transactionAuthorizationRef.current) return;"));
  assert(send.includes("if (result.success) {"));
  assert(send.includes("isAfricanPayout ||"));
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

Deno.test("African rails are available by verified account, never by tester email", () => {
  const sources = [send, receive, capabilities, receiveEndpoint, payoutEndpoint, accessGate].join("\n");
  assert(!sources.includes("adhiamboadhiambo22@gmail.com"));
  assert(!sources.includes("AFRICAN_RAILS_TEST_EMAILS"));
  assert(!sources.includes("isAfricanRailsTesterEmail"));
  assert(!sources.includes("yellowcard-sandbox-transaction"));
  assert(send.includes("canDiscoverAfricanRails"));
  assert(receive.includes("canDiscoverAfricanRails"));
  assert(capabilities.includes("authenticateVerifiedAfricanRailsUser"));
  assert(receiveEndpoint.includes("authenticateVerifiedAfricanRailsUser"));
  assert(payoutEndpoint.includes("authenticateVerifiedAfricanRailsUser"));
  assert(accessGate.includes('verificationStatus !== "approved"'));
});

Deno.test("production sends preserve dashboard data and receive enforces provider limits", () => {
  assert(send.includes("if (!isAfricanPayout) backendAPI.financial.invalidateForUser(userId);"));
  assert(mainApp.includes("onComplete={navigateBack}"));
  assert(backend.includes("preserveKnownFinancialSurfaces"));
  assert(backend.includes("financial_surfaces_partial: true"));
  assert(send.includes("yellowCardJitPayout"));
  assert(send.includes("provider_confirmation_pending"));
  assert(receive.includes("collectionProviderMinimum !== null && amount < collectionProviderMinimum"));
  assert(receive.includes("Minimum amount is"));
  assert(receive.includes("collectionNetworksLoading || !collectionProviderLimitsReady"));
  assert(receive.includes("setCollectionProviderLimitsReady(channelRows.length > 0)"));
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
