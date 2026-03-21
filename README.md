# BorderPay Africa — PWA

Mobile-first Pan-African fintech app. React 18 + Vite + TailwindCSS + Supabase.

## Quick Start

```bash
npm install --legacy-peer-deps
npm run dev
```

The app runs fully with **mock data** out of the box — no backend required for preview.

## Connecting to Supabase

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SERVER_FUNCTION=your-edge-function-name
```

### Database Setup

Run `utils/supabase/schema.sql` in your Supabase SQL editor to create all tables and RLS policies.

## Screens (51 total)

| Group | Screens |
|---|---|
| Auth | Splash, Login, Sign Up (6 steps), Forgot Password, App Lock, PIN Verify |
| Main | Dashboard, Profile, Notifications, Referral |
| Wallets | Wallets List, USD Account, Africa Wallet, Stablecoins |
| Transfers | Send (Local/USD/Stablecoin/P2P), Receive, Add Money |
| Exchange | Swap, FX History, Live Rates |
| Cards | Cards List, Card Detail, Frozen Card, Issue Card |
| Transactions | History, Detail |
| KYC | Intro, Settings, Identity, Address, Proof of Address, Review, Pending |
| Security | PIN Setup, 2FA Setup, Biometric |
| Settings | Settings, Preferences, Payment Methods, Change PIN, Change Password, Terms, Privacy |
| States | PIN Confirm, Tx Success, Tx Failed, New Device Alert |

## Environment Variables

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key |
| `VITE_SUPABASE_PROJECT_ID` | Project ID (extracted from URL) |
| `VITE_SERVER_FUNCTION` | Edge Function name for backend routes |

## Tech Stack

- React 18 + TypeScript
- Vite 5
- TailwindCSS v4
- Supabase (Auth + DB + Edge Functions)
- Framer Motion
- Lucide Icons
- SmileID (KYC/biometric)
- Maplerad (payments backbone)
