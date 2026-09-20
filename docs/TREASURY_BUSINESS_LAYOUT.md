# Treasury aligned with the business dashboard

The founder workspace now follows the existing `BusinessDashboard` and
`AppShell` visual structure: floating circular header controls, company identity,
a rounded balance card, a horizontal account strip, lime Send action,
rounded Treasury chart and floating five-action navigation. Desktop uses the
business app's horizontal navigation. The menu supports Escape and focus handling.

The treasury keeps its own data endpoint and founder access boundary. It does
not mount the customer dashboard or its customer ledger hooks. No customer app
component, shared shell, global stylesheet, financial routing or backend policy
is changed by this visual revision. Existing sort-code formatting, refresh
recovery, native origins, PIN, idempotency and live balance checks are retained.

Navigation includes only supported treasury actions: Home, Send, Receive, Wallet,
and Activity. Source/destination amounts retain their currencies. EURC remains
separate from the USD-stablecoin total. Account amounts stay on one line.

Validation: TypeScript; production Vite build; safety boundary; 93 treasury
source invariants; desktop/390px/320px browser checks for navigation, GBP sort
code, search, pending filters, overspend prevention, one fixture submission,
refresh failure/recovery, menu open/Escape/navigation and horizontal overflow.
No real transfer is made by the tests. Browser screenshots use fixture balances.

Replacement TestFlight target: 1.0.9 (67), replacing build 66 for treasury testing.
