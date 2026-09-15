#!/usr/bin/env python3
"""Blocking P0 gates for native KYB handoff and complete transaction receipts."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
kyc_ui = (ROOT / "components/kyc/KYCVerification.tsx").read_text()
kyc = (ROOT / "supabase/functions/bridge-kyc-link/index.ts").read_text()
kyb = (ROOT / "supabase/functions/bridge-kyb-link/index.ts").read_text()
guard = (ROOT / "supabase/functions/_shared/bridge-verification-url.ts").read_text()
receipt = (ROOT / "utils/transactions/receipt.ts").read_text()
receipt_component = (ROOT / "components/transactions/ReceiptProviderDetails.tsx").read_text()
worker = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text()
screens = "\n".join((ROOT / path).read_text() for path in [
    "components/transactions/TransactionsScreen.tsx",
    "components/app/Dashboard.tsx",
    "components/notifications/NotificationBell.tsx",
    "components/notifications/NotificationsScreen.tsx",
])

checks = {
    "native runtime is explicit": "isNativeRuntime()" in kyc_ui,
    "native KYB opens outside WebView": "Browser.open({ url, presentationStyle: 'popover' })" in kyc_ui,
    "native handoff uses official Browser plugin": "import { Browser } from '@capacitor/browser'" in kyc_ui,
    "native handoff never uses a blank placeholder": "window.open('about:blank'" not in kyc_ui,
    "web/PWA retains browser navigation": "window.location.assign(url)" in kyc_ui,
    "Persona is never sent to the ToS iframe": "openHostedVerificationUrl(r.data.link_url" not in kyc_ui,
    "client always requests public HTTPS callback": "https://app.borderpayafrica.com/?screen=kyc" in kyc_ui,
    "KYB request rejects native callbacks": "verificationRedirectUrl(APP_URL, body.redirect_url)" in kyb,
    "KYC request rejects native callbacks": "verificationRedirectUrl(APP_URL, body.redirect_url)" in kyc,
    "KYB response rewrites stale callbacks": "verifiedHostedLink(APP_URL, link.link_url)" in kyb,
    "KYC response rewrites stale callbacks": "verifiedHostedLink(APP_URL, links.kyc_link_url)" in kyc,
    "KYB persists normalized URL": "bridge_kyb_link_url: clientLinkUrl" in kyb,
    "KYC persists normalized URL": "bridge_kyc_link_url: clientLinkUrl" in kyc,
    "native schemes are rejected centrally": "Native origins such as capacitor://localhost are intentionally rejected" in guard,
    "legacy callback parameter is removed": 'target.searchParams.delete("redirect_uri")' in guard,
    "customer receipt label is provider-neutral": "BorderPay transaction ID" in receipt and "Bridge transaction ID" not in receipt_component,
    "all four customer activity surfaces render details": screens.count("ReceiptProviderDetails") >= 8,
    "receipt includes bank identity fields": all(key in receipt for key in ["sourceBankName", "sourceBankRoutingNumber", "receivingBankName"]),
    "receipt includes bank tracing fields": all(key in receipt for key in ["trackingNumber", "traceId", "imad", "uetr"]),
    "receipt includes blockchain tracing fields": all(key in receipt for key in ["sourceTransactionHash", "destinationTransactionHash", "gasFeeAmount"]),
    "receipt includes full refund evidence": all(key in receipt for key in ["refundReturnReason", "refundRiskRejectionReason", "refundReferenceId"]),
    "internal wallet rail is customer-normalized": "rail !== 'bridge_wallet'" in receipt and "asset === 'USDT'" in receipt and "asset === 'USDC' || asset === 'EURC'" in receipt,
    "transfer status keeps webhook evidence": 'kind: "transfer_status"' in worker and "receipt: d?.receipt ?? null" in worker and "raw: d" in worker,
    "VA status keeps webhook evidence": 'kind: "virtual_account_deposit_status"' in worker and worker.count("raw: d") >= 6,
    "arbitrary raw webhook fields are not rendered": "jsonb_object_keys" not in receipt and "Object.entries(raw" not in receipt,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("p0_native_kyb_receipt_regression_audit: FAIL\n- " + "\n- ".join(failed))
print(f"p0_native_kyb_receipt_regression_audit: PASS ({len(checks)}/{len(checks)})")
