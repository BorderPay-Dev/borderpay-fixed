#!/usr/bin/env python3
"""
Regression guard for business team invitations.

Invariants:
- Business team invites send a branded email through the unified send-email path.
- Invite links are token based, stored as hashes, expire, and require same-email auth.
- Accepted members are recognized as business workspace users on the frontend.
- Invite landing supports new teammates with signup as the primary path and
  makes clear signup joins the existing business workspace.
- Public templates must not expose infrastructure/provider names.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.is_file():
      raise AssertionError(f"missing file: {rel}")
    return path.read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    invite = read("supabase/functions/business-team-invite/index.ts")
    accept = read("supabase/functions/business-team-accept/index.ts")
    template = read("supabase/functions/_shared/email-templates/business/team-invite.ts")
    registry = read("supabase/functions/_shared/email-templates/index.ts")
    app = read("App.tsx")
    landing = read("components/auth/TeamInviteLanding.tsx")
    main_app = read("components/app/MainApp.tsx")
    api = read("utils/api/backendAPI.ts")
    migration = read("supabase/migrations/20260718093000_business_team_invite_acceptance.sql")

    require("template: \"business.team_invite\"" in invite, "Invite function must send business.team_invite")
    require("sha256Hex" in invite and "invite_token_hash" in invite, "Invite token must be stored hashed")
    require("invite_expires_at" in invite and "INVITE_TTL_DAYS" in invite, "Invite must have an expiry")
    require("business-team-invite:" in invite and "tokenHash.slice" in invite, "Resent invites need fresh idempotency keys")

    require("business.team_invite" in registry and "team-invite.ts" in registry, "Template must be registered")
    require("Accept invite" in template and "same email address" in template, "Template must explain accept flow")
    for forbidden in ["bridge", "flutterwave", "yellow card", "yellowcard"]:
        require(forbidden not in template.lower(), f"Provider leaked in team invite template: {forbidden}")

    require("Authorization required" in accept and "supa.auth.getUser" in accept, "Accept endpoint must require auth")
    require("invite_token_hash" in accept and "sha256Hex" in accept, "Accept endpoint must match hashed token")
    require("email_mismatch" in accept and "invitedEmail !== userEmail" in accept, "Accept endpoint must enforce invited email")
    require("status: \"active\"" in accept and "member_user_id: user.id" in accept, "Accept endpoint must activate membership")

    require("TeamInviteLanding" in app and "/team/invite" in app, "App must route team invite links")
    require("borderpay_pending_team_invite_token" in app, "Invite token must survive sign-in/sign-up")
    require("Create teammate login" in landing, "Invite landing must offer signup as teammate login")
    require("Already have a BorderPay account? Sign in" in landing, "Invite landing must keep sign-in path for existing users")
    require("does not create a separate business account" in landing, "Invite landing must not imply a new business workspace")
    require(
        landing.find("onNavigateToSignUp()") < landing.find("onNavigateToLogin()"),
        "Invite landing primary action must be signup before existing-user sign-in",
    )
    require("acceptInvite" in api and "business-team-accept" in api, "Frontend API must expose acceptInvite")
    require("backendAPI.team.list()" in main_app and "company_name" in main_app, "MainApp must detect accepted team membership")

    require("invite_token_hash" in migration and "accepted_at" in migration, "Migration must add invite acceptance columns")

    print("business_team_invite_email_audit: PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print("business_team_invite_email_audit: FAIL", file=sys.stderr)
        print(f" - {exc}", file=sys.stderr)
        raise SystemExit(1)
