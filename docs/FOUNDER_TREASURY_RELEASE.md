# Founder treasury workspace — 2026-09-17

The founder's treasury inherited an 8-second API deadline despite its snapshot
requiring several live provider reads. Silent refresh failures left stale data
without explanation. GBP account projection omitted `sort_code` and
`bank_sort_code`, leaving the existing GBP sort-code label empty.

The dedicated treasury now has a persistent desktop sidebar, mobile navigation,
asset balances, receiving-bank instructions, searchable activity and a PIN review
flow. GBP sort codes preserve leading zeroes, display as `XX-XX-XX`, and are
copyable. Failed and refunded transfers no longer count as pending. Chart volume
excludes unsettled funds and explicitly covers only returned records.

Treasury-only requests have bounded authentication, body parsing and network
waits (45 seconds for reads, 60 for transfers). Refreshes cannot overlap; failures
keep the previous snapshot with a visible error. Money movement is never
retried automatically. Provider ownership, live balance, PIN, SCA guard and
durable idempotency checks remain unchanged on the server.

Isolation:
- Existing founder route and server access registry are unchanged.
- No consumer components, shared API wrapper, shared provider, regional policy,
  SCA policy, signup, mobile build or global stylesheet changes.
- Deploy the backend from the downloaded live function dependencies, replacing
  only `bridge-operator-readonly/index.ts` and adding its account projection helper.
- Deploy the frontend from live production baseline
  `decfcd28fcaf8804b26482b0836b8e4b5e0e1172` plus this treasury change. Main has
  unrelated affiliate UI changes which are excluded from this release.
- No SQL migration, no real transfer, no customer impersonation, no email.

Validation: TypeScript, Deno edge check, 10 behavioral tests, 92 source invariants,
repository safety-boundary check, Vite production build, and fixture-based Chrome
checks at desktop, 390px and 320px. Browser checks cover all navigation, sort code,
activity search, pending status, overspend prevention, single submission and
refresh failure/recovery. See `tests/treasury/README.md` for reproduction.

Live evidence before change: recent treasury snapshot audits succeeded for three
wallet asset rows, three receiving accounts and seven activity records. A real
signed-in founder read after deployment remains necessary to confirm the live
GBP value; fixtures do not establish a specific production bank sort code.
