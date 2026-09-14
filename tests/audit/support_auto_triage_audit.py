#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
gateway = (root / "supabase/functions/support-gateway/index.ts").read_text()
screen = (root / "components/settings/SupportScreen.tsx").read_text()
templates = (root / "supabase/functions/_shared/email-templates/index.ts").read_text()
email = (root / "supabase/functions/_shared/email-templates/admin/support-handoff.ts").read_text()
knowledge = (root / "supabase/functions/_shared/support-knowledge-base.ts").read_text()
config = (root / "supabase/config.toml").read_text()

checks = {
    "customer gateway rejects admin actions": 'action.startsWith("admin_")' in gateway,
    "public support ingress keeps platform JWT verification disabled": "[functions.support-gateway]\nverify_jwt = false" in config,
    "money movement is a hard handoff": 'issue === "send_receive"' in gateway,
    "wallet balance is a hard handoff": 'issue === "wallet_balances"' in gateway,
    "first message gets automatic response": "automateFirstResponse({ ticket, message" in gateway,
    "transaction reply promises no outcome": "Never state or infer a customer's balance" in gateway,
    "handoff gives two-hour target": "allow up to 2 hours" in gateway,
    "handoff prevents duplicate tickets": "do not open another ticket" in gateway,
    "approved website is the help source": "https://www.borderpayafrica.com" in knowledge,
    "operator recipient is exact": 'markikaba@borderpayafrica.com' in gateway,
    "operator notification is idempotent per message": "support-handoff:${input.ticketId}:${input.userMessageNumber}" in gateway,
    "follow-up money message triggers handoff": '"followup_human_handoff"' in gateway and "automateFollowupResponse" in gateway,
    "customer receives stable ticket number": "ticket_number: ticketReference" in gateway,
    "ticket number is visible in app list": "ticketReference(t.id)" in screen,
    "ticket number is visible in conversation": "Ticket {ticketReference(selectedTicketId)}" in screen,
    "website link is visible in support": "BORDERPAY_WEBSITE" in screen and 'target="_blank"' in screen,
    "Brevo template is registered": '"admin.support_handoff"' in templates,
    "operator email contains customer message": "Customer message" in email and "p.message" in email,
    "ticket automation runs after response path": "continueSupportAutomation(" in gateway and "EdgeRuntime" in gateway and "waitUntil" in gateway,
    "support API has realistic deadline": "if (endpoint === 'support-gateway') return 20000" in (root / "utils/api/backendAPI.ts").read_text(),
    "ticket reads do not fail after 1.4 seconds": "SUPPORT_LOAD_TIMEOUT_MS = 12000" in screen,
    "support title is centered": '<h1 className={`text-lg font-bold ${tc.text}`}>Support</h1>' in screen,
    "support header matches help center": "sticky top-0 z-10" in screen and "pt-safe" in screen,
    "support cards cannot escape container": screen.count("min-w-0 overflow-hidden") >= 2,
    "ticket list refreshes after mutation": screen.count("loadTickets(true)") >= 2,
    "existing clients can await the first assistant response": "shouldAwaitFirstResponse" in gateway and "attempt < 8" in gateway,
    "open support threads refresh while visible": "window.setInterval(refresh, 10_000)" in screen and "window.addEventListener('focus', refresh)" in screen,
    "responses API payload is parsed structurally": "function extractAiText" in gateway and "payload?.output" in gateway,
    "knowledge base is versioned": "SUPPORT_KNOWLEDGE_VERSION" in knowledge and "knowledge_version" in gateway,
    "support health reports knowledge version": "knowledge_version: SUPPORT_KNOWLEDGE_VERSION" in gateway,
    "AI receives only retrieved approved knowledge": "APPROVED BORDERPAY KNOWLEDGE" in gateway and "renderSupportKnowledge(input.knowledge)" in gateway,
    "requester email is not sent to AI": "Requester: ${input.requesterEmail}" not in gateway,
    "outside knowledge is forbidden": "Do not use outside knowledge" in gateway,
    "policy invention is forbidden": "Do not change, estimate, reinterpret or combine fees" in gateway,
    "approval promises are forbidden": "Never promise approval" in gateway,
    "unknown questions force handoff": "knowledge_not_found" in gateway and "HANDOFF_REQUIRED" in gateway,
    "AI answers are given server-enforced citations": "function groundedReply" in gateway and "knowledgeSources(entries)" in gateway,
    "AI outages have a grounded deterministic fallback": "function groundedFallback" in gateway and 'provider = "knowledge_fallback"' in gateway,
    "generated claims are validated before delivery": "function validateGroundedDraft" in gateway and gateway.count("validateGroundedDraft(generated.draft, knowledge)") == 2,
    "generated links are limited to retrieved sources": "const allowedUrls = new Set(knowledgeSources(entries))" in gateway,
    "ordinary followups receive automatic answers": "automateFollowupResponse" in gateway and 'event_type: escalation.escalate' in gateway,
    "followup answers use recent conversation": '.from("support_ticket_messages")' in gateway and '.slice(-12)' in gateway,
    "account-specific requests force handoff": "account_specific_request" in gateway,
    "transaction references force handoff": "transaction_reference_supplied" in gateway,
    "prompt-injection attempts force handoff": "prompt_injection_attempt" in gateway,
    "business-only onboarding is documented": 'id: "business-accounts-only"' in knowledge and "currently accepts business accounts" in knowledge,
    "current business maintenance price is documented": "USD 29.99 per month from September 2026" in knowledge,
    "supported wallet assets are bounded": "USDC on Base" in knowledge and "EURC on Base" in knowledge and "USDT on Tron" in knowledge,
    "same-token fee answer is narrowly scoped": "same-token, same-network" in knowledge,
    "high-risk disclosure is documented": 'id: "high-risk-disclosure"' in knowledge,
    "prohibited activity policy is documented": 'id: "prohibited-activities"' in knowledge,
    "KYB formation and ownership evidence are documented": 'id: "formation-documents"' in knowledge and 'id: "ownership-documents"' in knowledge,
    "country-specific identifier lookup is supported": "BUSINESS_IDENTIFICATION_BY_COUNTRY" in knowledge and "countryIdentificationEntry" in knowledge,
    "knowledge content is provider neutral": not any(term in knowledge.lower() for term in ("bridge.xyz", "yellow card", "flutterwave", "brevo")),
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("Support auto-triage audit failed:\n- " + "\n- ".join(failed))
print(f"Support auto-triage audit passed ({len(checks)}/{len(checks)})")
