from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
gateway = (ROOT / "supabase/functions/public-api-gateway/index.ts").read_text()
admin = (ROOT / "supabase/functions/api-gateway-admin/index.ts").read_text()
gates = (ROOT / "supabase/functions/_shared/api-release-gates.ts").read_text()

checks = {
    "production runtime defaults locked": 'reason: "production_api_locked"' in gates,
    "provider writes have independent kill switch": "API_PARTNER_PROVIDER_WRITES_ENABLED" in gates,
    "sandbox writes require explicit enablement": "API_PARTNER_SANDBOX_WRITES_ENABLED" in gates,
    "provider environment must match tenant mode": 'providerEnvironment !== mode' in gates,
    "gateway evaluates release gate": "evaluateApiRuntimeReleaseGate" in gateway,
    "release gate precedes provider dispatch": gateway.find("evaluateApiRuntimeReleaseGate(") < gateway.find("handlerResult = await handleRoute("),
    "admin promotion uses independent gate": "productionPromotionAllowed" in admin,
    "promotion denial is fail closed": "production_promotion_locked" in admin,
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(1)
print("api sandbox lock audit: PASS")
