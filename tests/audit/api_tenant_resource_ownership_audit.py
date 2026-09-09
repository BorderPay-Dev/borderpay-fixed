#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
gateway = (ROOT / "supabase/functions/public-api-gateway/index.ts").read_text()
migration = (ROOT / "supabase/migrations/20260817090000_api_tenant_provider_resource_ownership.sql").read_text()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def route(start: str, end: str) -> str:
    return gateway.split(start, 1)[1].split(end, 1)[0]


customer = route('routeKey === "POST /v1/customers"', 'routeKey === "POST /v1/wallets"')
wallet = route('routeKey === "POST /v1/wallets"', 'routeKey === "POST /v1/virtual-accounts"')
virtual_account = route('routeKey === "POST /v1/virtual-accounts"', 'routeKey === "POST /v1/transfers"')
transfer = route('routeKey === "POST /v1/transfers"', 'routeKey === "POST /v1/webhooks"')

require("api_tenant_provider_resources_provider_identity_unique" in migration,
        "provider identity has a global unique ownership binding")
require("foreign key (tenant_end_user_id, tenant_id)" in migration,
        "resource ownership is constrained to the same tenant end user")
require("from public, anon, authenticated" in migration and migration.count("to service_role") >= 3,
        "ownership RPCs are restricted to service role")
require("resolveTenantEndUser(" in customer and customer.find("resolveTenantEndUser(") < customer.find("bridgeProvider.createCustomer("),
        "customer tenant mapping is resolved before provider creation")
require("borderpay_user_id: tenantEndUser.userId" in customer,
        "partner-controlled external id is replaced by the authoritative internal user id")
require(customer.find("bridgeProvider.createCustomer(") < customer.find("registerTenantResource("),
        "created customer is authoritatively registered")
require(wallet.find("assertTenantResource(") < wallet.find("bridgeProvider.createWallet("),
        "wallet customer ownership is checked before provider creation")
require(virtual_account.find("assertTenantResource(") < virtual_account.find("bridgeProvider.createVirtualAccount("),
        "virtual-account customer ownership is checked before provider creation")
require(transfer.find("providerReferencesForTransfer(") < transfer.find("bridgeProvider.createTransfer("),
        "transfer provider identifiers are collected before provider creation")
require(transfer.find("assertTenantResource(") < transfer.find("bridgeProvider.createTransfer("),
        "transfer ownership is checked before provider creation")
require(transfer.find("bridgeProvider.createTransfer(") < transfer.find("registerTenantResource("),
        "created transfer is authoritatively registered")
