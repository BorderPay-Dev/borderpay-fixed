#!/usr/bin/env python3
"""
Business frontend triage audit.

This locks the narrow production fixes for the reported business-account UI
issues: business-specific KYB/profile labels, a dependency-light Cards coming
soon screen, and a bounded Team load with retry.

Non-runtime: parses source as text. No deploy, DB, or network.

Run: python3 tests/audit/business_frontend_triage_audit.py
"""

from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    path = ROOT / rel
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def main() -> int:
    shell = read("components/shell/AppShell.tsx")
    settings = read("components/settings/SettingsScreen.tsx")
    profile = read("components/profile/ProfileScreen.tsx")
    cards = read("components/cards/CardsScreen.tsx")
    team = read("components/team/TeamScreen.tsx")
    main_app = read("components/app/MainApp.tsx")
    business_dash = read("components/business/BusinessDashboard.tsx")
    client = read("utils/supabase/client.ts")
    signup = read("components/auth/SignUpFlow.tsx")

    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "B1 drawer shows KYB for business accounts",
        "isBusinessAccount ? tt('nav.kyb', 'Business KYB')" in shell
        and "tt('nav.kyc', 'Identity & KYC')" in shell,
        "AppShell drawer must render Business KYB for business accounts and keep Identity & KYC for individuals",
    ))

    checks.append((
        "B2 settings profile entry is business-aware",
        "authAPI.getStoredUser()" in settings
        and "storedUser?.account_type === 'business'" in settings
        and "isBusinessAccount ? 'Business information' : t('settings.personalInfo')" in settings,
        "SettingsScreen must label the profile entry Business information for business accounts",
    ))

    checks.append((
        "B3 profile copy is business-aware without fake company writes",
        "profile.account_type === 'business'" in profile
        and "Business profile" in profile
        and "Business information" in profile
        and "Primary contact" in profile
        and "Company name" not in profile,
        "ProfileScreen must show business copy while avoiding a Company name label on the user full_name field",
    ))

    overpromises = [
        "funded from your USD balance",
        "Spend anywhere Mastercard is accepted",
        "Freeze, unfreeze",
        "terminate in one tap",
    ]
    checks.append((
        "B4 cards screen is locked and does not overpromise issuing",
        "from 'motion/react'" not in cards
        and "WebkitMaskImage" not in cards
        and "Cards are locked" in cards
        and "No card can be issued yet" in cards
        and "mock" not in cards.lower()
        and all(phrase not in cards for phrase in overpromises),
        "CardsScreen must avoid fragile animation/mask dependencies, mock cards, and active issuing promises",
    ))

    checks.append((
        "B5 team screen load is bounded and retryable",
        "TEAM_LOAD_TIMEOUT_MS = 10_000" in team
        and "withTimeout(" in team
        and "backendAPI.team.list()" in team
        and "Team is taking longer than expected. Please try again." in team
        and "onClick={load}" in team
        and "Retry" in team,
        "TeamScreen must timeout the roster call and show a Retry action",
    ))

    checks.append((
        "B6 business accounts display company name, not owner name",
        "'company_name'" in client
        and "company_name: formData.companyName" in signup
        and "getBusinessDisplayName(" in main_app
        and "backendAPI.business.getProfile()" in main_app
        and "company_name = biz.data.company_name" in main_app
        and "setShellUserName(company_name)" in main_app
        and "company_name" in business_dash
        and "initialCompanyName" in business_dash
        and "Business name" in profile
        and "displayName = isBusinessAccount" in profile
        and "profile.company_name" in profile,
        "Business shell/dashboard/profile must prefer business_profiles.company_name and cache it for first paint",
    ))

    checks.append((
        "B7 profile fast-paints business data before company refresh",
        "cachedCompanyName" in profile
        and "mergeProfileCache" in profile
        and profile.find("setProfile(profileData)") >= 0
        and profile.find("backendAPI.business.getProfile()") >= 0
        and profile.find("setProfile(profileData)") < profile.find("backendAPI.business.getProfile()")
        and "setProfile((p) => ({ ...p, company_name }))" in profile
        and "mergeProfileCache({ company_name, account_type: 'business' })" in profile,
        "ProfileScreen must render cached/profile data immediately, then patch company_name from business_profiles in the background",
    ))

    checks.append((
        "B8 dashboard and shell fast-paint cached business name",
        "stored?.company_name || stored?.full_name || 'Your business'" in business_dash
        and "useState<string>(initialCompanyName)" in business_dash
        and "r.data.company_name || initialCompanyName || 'Your business'" in business_dash
        and "cached?.company_name" in main_app
        and "const displayName = getBusinessDisplayName({ ...u, account_type: t })" in main_app
        and main_app.find("const displayName = getBusinessDisplayName({ ...u, account_type: t })") < main_app.find("backendAPI.business.getProfile()")
        and "localStorage.setItem('borderpay_user', JSON.stringify({ ...latest, account_type: 'business', company_name }))" in main_app,
        "BusinessDashboard and MainApp shell must show cached company name before the business profile network refresh",
    ))

    print("business_frontend_triage_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for _, p, _ in checks if p)}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
