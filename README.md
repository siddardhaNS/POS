# Tiffin: multi-tenant restaurant POS (India & US)

| Part | Stack | Folder |
|---|---|---|
| Website, POS, admin console | Next.js 15 + shadcn/ui + Tailwind 4 | `web/` |
| API | FastAPI + SQLAlchemy | `api/` |
| Database | PostgreSQL | docker / Neon |
| Mobile | React Native (next phase) | `mobile/` |

## Run locally

```bash
docker compose up -d --build          # Postgres :5432 + API :8010
cd web && cp .env.example .env.local && npm install && npm run dev   # http://localhost:3100
```

Pages: `/` landing · `/signup` free-trial application · `/login` · `/pos` restaurant POS · `/admin` platform console.

Demo accounts (seeded when `SEED_DEMO=true`):

| Who | Login |
|---|---|
| Platform admin | admin@tiffin.app / admin12345 |
| India restaurant owner | owner@tiffin.in / demo12345 (staff PINs: manager 2222, cashier 3333, captain 4444, chef 5555) |
| US restaurant owner | owner@saffronsmoke.com / demo12345 (same PINs) |

## How tenancy works

- Every business row has a `tenant_id`, and every API request is scoped to the signed-in user's tenant.
- Signup creates a tenant with status `pending`, and its owner can't sign in until a platform admin approves it.
- On approval the tenant moves to `trial` (14 days), and its menu, tables and taxes are provisioned for its market (INR + GST, or USD + sales tax + tips).
- Admins can also reject, suspend, reinstate, or mark a restaurant as paying (`active`).
- Roles: owner, manager, cashier, captain, chef. Permissions live in `api/app/deps.py`.

## Deploy on Vercel

Create two Vercel projects from this repo:

1. **API**: root directory `api/` (uses `index.py` + `vercel.json`). Env vars:
   `DATABASE_URL` (Neon / Vercel Postgres), `JWT_SECRET`, `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`,
   `CORS_ORIGINS=https://<your-web-domain>`, `SEED_DEMO=false`.
2. **Web**: root directory `web/`. Env var: `NEXT_PUBLIC_API_URL=https://<your-api>.vercel.app`.
