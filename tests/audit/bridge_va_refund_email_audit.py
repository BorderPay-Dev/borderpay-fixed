from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

process = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text()
individual = (ROOT / "supabase/functions/_shared/email-templates/individual/transaction-status.ts").read_text()
business = (ROOT / "supabase/functions/_shared/email-templates/business/transaction-status.ts").read_text()

failures: list[str] = []

def require(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)

for name, src in {"individual": individual, "business": business}.items():
    require("refund_return_reason" in src, f"{name} transaction template must accept refund return reason.")
    require("refund_returned_at" in src, f"{name} transaction template must accept returned timestamp.")
    require("refund_risk_rejection_reason" in src, f"{name} transaction template must accept risk rejection reason.")
    require("refund_rail" in src, f"{name} transaction template must accept refund rail.")
    require("refund_beneficiary_name" in src, f"{name} transaction template must accept refund beneficiary.")
    require("refund_reference_id" in src, f"{name} transaction template must accept refund reference ID.")
    require("The payment has been refunded to the original destination." in src,
            f"{name} refund email must use Bridge-aligned refund destination copy.")
    require("funds are no longer available in your BorderPay account" not in src,
            f"{name} refund email must not imply VA funds were spendable in BorderPay.")

require("function bridgeVaRefundDetails" in process, "process-pending-events must extract Bridge refund details.")
for needle in [
    "refund.reason",
    "refund.refunded_at",
    "refund.risk_rejection_reason",
    "source.payment_rail",
    "source.sender_name",
    "refund.refund_reference_id",
    "refundReturnReason",
    "refundReturnedAt",
    "refundRiskRejectionReason",
    "refundRail",
    "refundBeneficiaryName",
    "refundReferenceId",
]:
    require(needle in process, f"process-pending-events missing refund metadata wiring: {needle}")

if failures:
    print("bridge_va_refund_email_audit: FAIL")
    for failure in failures:
        print(f"- {failure}")
    raise SystemExit(1)

print("bridge_va_refund_email_audit: PASS")
