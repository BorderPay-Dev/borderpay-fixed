function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

const send = await Deno.readTextFile(new URL("../components/send/SendMoneyFlow.tsx", import.meta.url));
const receive = await Deno.readTextFile(new URL("../components/receive/ReceiveMoneyScreen.tsx", import.meta.url));
const app = await Deno.readTextFile(new URL("../App.tsx", import.meta.url));
const lock = await Deno.readTextFile(new URL("../components/security/AppLockScreen.tsx", import.meta.url));
const yellowCardTransaction = await Deno.readTextFile(new URL("../supabase/functions/yellowcard-transaction/index.ts", import.meta.url));
const capabilities = await Deno.readTextFile(new URL("../supabase/functions/yellowcard-capabilities/index.ts", import.meta.url));
const backend = await Deno.readTextFile(new URL("../utils/api/backendAPI.ts", import.meta.url));
const mainApp = await Deno.readTextFile(new URL("../components/app/MainApp.tsx", import.meta.url));

Deno.test("African send remains fail closed during the production receive cutover", () => {
  assert(send.includes("const africanPayoutEnabled = false;"));
  assert(send.includes("African payouts are temporarily unavailable"));
  assert(yellowCardTransaction.includes('!flag("YC_PRODUCTION_SEND_ENABLED")'));
  assert(yellowCardTransaction.includes('code: "yellow_card_payout_locked"'));
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

Deno.test("production collection uses verified identity and never substitutes test KYC", () => {
  assert(yellowCardTransaction.includes("if (profile.bridge_customer_id && ("));
  assert(yellowCardTransaction.includes("bridgeProvider.getCustomerProfile(profile.bridge_customer_id)"));
  assert(yellowCardTransaction.includes("idNumber: str(profile.id_number || bridgeIdentity?.id_number)"));
  assert(!yellowCardTransaction.includes("useSandboxIdentitySample"));
  assert(!yellowCardTransaction.includes("0123456789"));
  assert(!yellowCardTransaction.includes("allow_all_receive_countries"));
});

Deno.test("production payouts fail closed and receive enforces provider limits", () => {
  assert(send.includes("const africanPayoutEnabled = false;"));
  assert(yellowCardTransaction.includes('!flag("YC_PRODUCTION_SEND_ENABLED")'));
  assert(yellowCardTransaction.includes('code: "yellow_card_payout_locked"'));
  assert(mainApp.includes("onComplete={navigateBack}"));
  assert(backend.includes("preserveKnownFinancialSurfaces"));
  assert(backend.includes("financial_surfaces_partial: true"));
  assert(send.includes("action: 'status'"));
  assert(send.includes("['failed', 'rejected', 'cancelled', 'canceled', 'expired']"));
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
