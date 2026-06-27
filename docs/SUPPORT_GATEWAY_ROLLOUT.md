# Support Gateway Rollout (App + Website + Admin)

## Scope
- In-app support now uses ticketing via `support-gateway`.
- Website support widget submits public support tickets to the same backend.
- Admin panel Support Tools now includes ticket queue + reply + status updates.

## Database migrations
Apply in order:
1. `20260627173000_support_ticketing_foundation.sql`
2. `20260627174500_support_public_widget_support.sql`

## Edge function
Deploy:
- `support-gateway`

## Website required env
Set in website deployment:
- `VITE_SUPPORT_GATEWAY_URL=https://<project-ref>.supabase.co/functions/v1/support-gateway`
- `VITE_SUPABASE_ANON_KEY=<public-anon-key>`

## Runtime smoke test
1. App: Settings -> Support -> create ticket -> ticket appears in list.
2. Website: submit widget ticket -> success response.
3. Admin: Support Tools -> ticket appears -> reply -> set resolved.
4. App: user sees status/message update on ticket refresh.

## AI phase (next)
Do not enable GPT until this path is stable.
Add AI only behind `support-gateway` (server-side), never from frontend.
