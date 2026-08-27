# AGENTS.md

## Cursor Cloud specific instructions

ZapMass is a single app (not a monorepo): a React + Vite + Tailwind frontend (`src/`)
and an Express + Socket.IO backend (`server/`) that share `shared/`. By default the
backend runs in **`vps` auth + data mode**, which is backed by **PostgreSQL**. Redis is
used for the campaign queue / cross-process session bridge. The WhatsApp engine
(`evolution`) and Firebase/Mercado Pago are external integrations that are NOT needed for
local development of auth, contacts, campaigns, chat, etc.

### Services to start each session (no systemd on this VM)
The system packages (PostgreSQL 16, Redis) are pre-installed in the snapshot, and the
`zapmass_db` data lives in the snapshot, but the daemons are NOT auto-started on boot.
Start them once per session before running the app:

```bash
sudo pg_ctlcluster 16 main start                       # PostgreSQL on :5432
sudo redis-server --daemonize yes --dir /var/lib/redis # Redis on :6379
```

(Run Redis with `--dir /var/lib/redis` so its `dump.rdb` is not written into the repo root.)

The Postgres superuser password is set to `evolution-secure-pass-2026` (matches the app's
default in `server/db/postgres.ts`). The backend auto-creates `zapmass_db` and runs SQL
migrations from `server/db/migrations/` on startup.

### Environment file
A gitignored `.env` at the repo root drives dev config (see `server/bootstrapEnv.ts`).
Key dev values: `NODE_ENV=development`, `ZAPMASS_AUTH_PROVIDER=vps`,
`ZAPMASS_DATA_PROVIDER=vps`, `POSTGRES_PASSWORD=evolution-secure-pass-2026`,
`REDIS_URL=redis://127.0.0.1:6379`, and `SUBSCRIPTION_ENFORCE=false` +
`VITE_ENFORCE_SUBSCRIPTION=false` so a fresh account isn't paywalled. If `.env` is missing,
recreate it with these values (it is intentionally not committed).

### Running the app (dev)
The root `npm run dev` script is **Windows-only** (its `*:dev:kill` steps call
`powershell`/`scripts/kill-port.ps1`). On this Linux VM run the two processes separately:

```bash
npm run server:dev                              # backend: tsx watch server/server.ts -> :3001
npx vite --host 0.0.0.0 --port 8000 --strictPort  # frontend -> :8000
```

Frontend: http://localhost:8000  ·  Backend health: http://localhost:3001/api/health
Vite proxies `/api` and `/socket.io` to `:3001`, so the app is effectively same-origin.

Expected harmless startup noise when no external services are configured: Evolution API
errors (`getaddrinfo EAI_AGAIN evolution`), missing `MERCADOPAGO_ACCESS_TOKEN`, missing
Firebase Admin, and one transient `owner-emit-redis` subscribe error at boot. None of
these block auth/contacts/campaigns.

### Lint / test / build
- Tests: `npm run test` (Vitest, ~280 tests).
- Static check: `npm run typecheck` (there is no ESLint config; tsc is the lint).
- Build: `npm run build` (production `vite build`; not needed for dev).

### Hello-world sanity check
Open the app, use the "Responsável" tab to register an owner account
(email + password + confirm password → "Continuar com e-mail"), then add a contact under
"Contatos". It persists to `zapmass.contacts` in Postgres.
