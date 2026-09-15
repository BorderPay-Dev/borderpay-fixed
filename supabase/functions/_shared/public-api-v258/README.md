# Public API production dependency snapshot

Downloaded from deployed `public-api-gateway` v258 on 2026-09-15. Its tenant
ownership, transfer-cap, balance, onboarding and provider-payload protections
were ahead of main. The SCA fix preserves this dependency graph in isolation
so deploying it cannot roll those protections back or change the shared
provider used by other payment functions. Provider type declarations come
from the existing local production source (types are not included in the
Supabase download).

The gateway entrypoint imports this snapshot and adds the current shared
unattested-transfer guard after existing source-owner authorization. This
snapshot should be reconciled with the shared API modules in a separate,
behavior-tested cleanup; it is not a second payment policy.
