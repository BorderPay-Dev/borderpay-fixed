# Bridge PR3 — `kyc-submit` retirement-safety investigation

Status: **read-only investigation + planning. No deletion, no edits to functions,
no deploy, no config change, no removed-provider text cleanup**. This document
records evidence and a verdict only. The later source cleanup is now handled by
#75.

## Verdict

**`kyc-submit` is already retired on the deployed side — there is nothing to delete
in production.** It is **not a deployed function**. The only residual is
**source/config hygiene** (a repo 410 stub, a `config.toml` pin + stale removed-provider
comment, and doc references), which should be handled in a **separate later cleanup
PR**. No further action was taken in this investigation.

> Caveat honoured: "orphaned" was treated as "no app caller, NOT proven deletable."
> This investigation went past app callers to check deployment state, cron/workers,
> config, DB tables, and edge traffic before concluding.

## Evidence (read-only, 2026-06-03)

| Check | Finding |
|---|---|
| **Deployed instance** | **NOT deployed.** `get_edge_function(kyc-submit)` → `NotFoundException`; absent from full `list_edge_functions`. (Deployed KYC set: `kyc-status` v35, `get-kyc-jobs` v11, `bridge-customer` v12, `bridge-kyc-link` v16, `bridge-kyb-link` v16.) |
| **Repo source** | `supabase/functions/kyc-submit/index.ts` is a **410 "Gone" stub** ("REMOVED (legacy provider)") — returns `{success:false, code:'provider_removed'}`. Not deployed. |
| **App callers** | None in `components/` or `utils/` (locked by `kyc_path_canonical_audit.py`, PR2). |
| **Cron / worker** | `cron.job` has only (1) the worker POST → `process-pending-events` and (2) `reap_stuck_processing(300)`. **Neither references `kyc-submit`.** |
| **Repo refs outside components/utils** | Docs + audits + the `config.toml` pin only — no programmatic callers. |
| **config.toml** | `[functions.kyc-submit] verify_jwt = true` pin present. Harmless for a non-deployed function. |
| **DB tables** | `kyc_submissions`: 5 rows, latest **2026-04-24** (stale). `kyc_documents`: 0 rows. No recent writes → legacy write path is dead. |
| **Edge logs** | **No `kyc-submit` invocations or 404s** in the captured ~24h window (only unrelated `session/activity` 404s). |
| **External/admin risk** | `DEPLOYMENT_AND_SMOKE_RUNBOOK.md` notes "stale admin tooling may still call it." Acknowledged unknown — but since the function is already not deployed, any such caller already receives a platform **404** today. |

## Correction to the record

The Bridge Core contract (`docs/bridge-core-contract.md`, via PR2) and earlier
gap-map notes described `kyc-submit` as "the **deployed** legacy … edge
function (orphaned)." **That is inaccurate — `kyc-submit` is NOT deployed.** Repo is
a 410 stub; there is no deployed instance. Recommend fixing this wording as part of
the later cleanup PR (kept out of this investigation-only change).

## Open question for CEO/CTO (no action taken)

Today a stale caller of `/functions/v1/kyc-submit` gets a generic platform **404**.
The repo 410 stub + runbook implied the intent to "fail loud" with a clear
`provider_removed` message — which would require **deploying** the 410 stub. Choose:

- **(A) Accept the platform 404** (do nothing; simplest — the path is dead and unused), or
- **(B) Deploy the 410 stub** once, so stale callers get an explicit `provider_removed` body.

Either is fine; this is a product/ops preference, not a safety issue.

## Recommended next step (separate, later, source-only)

Cleanup follow-up (#75): correct the contract wording, keep Decision A, and tidy
removed-provider references in source/docs — one reviewable change, no money
movement, no behavior change.
