#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
gateway = (root / "supabase/functions/support-gateway/index.ts").read_text()
screen = (root / "components/settings/SupportScreen.tsx").read_text()
templates = (root / "supabase/functions/_shared/email-templates/index.ts").read_text()
email = (root / "supabase/functions/_shared/email-templates/admin/support-handoff.ts").read_text()

checks = {
    "customer gateway rejects admin actions": 'action.startsWith("admin_")' in gateway,
    "money movement is a hard handoff": 'issue === "send_receive"' in gateway,
    "wallet balance is a hard handoff": 'issue === "wallet_balances"' in gateway,
    "first message gets automatic response": "automateFirstResponse({ ticket, message" in gateway,
    "transaction reply promises no outcome": "Never state or infer a customer's balance" in gateway,
    "handoff gives two-hour target": "allow up to 2 hours" in gateway,
    "handoff prevents duplicate tickets": "do not open another ticket" in gateway,
    "approved website is the help source": "https://www.borderpayafrica.com" in gateway,
    "operator recipient is exact": 'markikaba@borderpayafrica.com' in gateway,
    "operator notification is idempotent per message": "support-handoff:${input.ticketId}:${input.userMessageNumber}" in gateway,
    "follow-up money message triggers handoff": 'event_type: "followup_human_handoff"' in gateway,
    "customer receives stable ticket number": "ticket_number: ticketReference" in gateway,
    "ticket number is visible in app list": "ticketReference(t.id)" in screen,
    "ticket number is visible in conversation": "Ticket {ticketReference(selectedTicketId)}" in screen,
    "website link is visible in support": "BORDERPAY_WEBSITE" in screen and 'target="_blank"' in screen,
    "Brevo template is registered": '"admin.support_handoff"' in templates,
    "operator email contains customer message": "Customer message" in email and "p.message" in email,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("Support auto-triage audit failed:\n- " + "\n- ".join(failed))
print(f"Support auto-triage audit passed ({len(checks)}/{len(checks)})")
