# RepoPulse

GitHub engineering health dashboard — pull-request cycle times, review latency, and
more. Day 1: monorepo scaffold, Postgres schema, GitHub OAuth, and a deployed skeleton.

## Architecture

- **Monorepo** (npm workspaces): [`backend/`](backend) Express + TypeScript API, [`frontend/`](frontend) Vite + React SPA.
- **Single origin**: the backend serves the built frontend from `frontend/dist`, so the deployed app lives on **one URL**. That keeps OAuth cookies trivial (no CORS / cross-site cookie work) and gives you one stable public URL for GitHub webhooks later.
- **Auth**: GitHub OAuth (Authorization Code + PKCE-less; `state` cookie protects against CSRF). Session is a **JWT in an httpOnly, SameSite=Lax cookie** (7-day expiry). The GitHub access token is stored **encrypted at rest** with AES-256-GCM.

```
Browser ── /auth/github/login ──▶ GitHub ──?code=...──▶ /auth/github/callback
                                                          │  exchange code for token
                                                          │  GET api.github.com/user
                                                          │  upsert User (token encrypted)
                                                          ▼
                                                     Set-Cookie repopulse_session=JWT
                                                     redirect ──▶ /  (SPA shows "Logged in as X")
```

## Local development

Prereqs: Node ≥ 20, and a PostgreSQL database. The repo doesn't ship one — point `DATABASE_URL` at any Postgres (local, **or a free [Neon](https://neon.tech) database** — the connection string works identically in dev and prod).

```bash
npm install                      # installs both workspaces
cp backend/.env.example backend/.env
# fill in GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / SESSION_SECRET / DATABASE_URL

npm run dev -w backend            # API on :3000 (serves last-built frontend)
npm run dev -w frontend           # optional: Vite HMR on :5173 (proxies /auth, /me to :3000)
```

First run against a fresh database:

```bash
npm run db:generate -w backend
npm run db:migrate -w backend     # creates + applies migrations (interactive)
```

### GitHub OAuth App

Register one at **github.com → Settings → Developer settings → OAuth Apps → New OAuth App**.

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/auth/github/callback`
- Scopes requested: `read:user`, `user:email` (primary verified email is saved if public).

For a deployed instance, update the callback URL to `https://<your-app>.up.railway.app/auth/github/callback` after first deploy.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Postgres connection string (`postgresql://user:pass@host:5432/db?schema=public`). |
| `GITHUB_CLIENT_ID` | ✅ | OAuth App client ID. |
| `GITHUB_CLIENT_SECRET` | ✅ | OAuth App client secret. |
| `SESSION_SECRET` | ✅ | Signs the session JWT. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `GITHUB_REDIRECT_URI` | ⬜ | Callback URL. Defaults to `http://localhost:3000/auth/github/callback`; set it to the deployed URL in production. |
| `ENCRYPTION_KEY` | ⬜ | Optional 32-byte key (64 hex chars) for AES-256-GCM token encryption. If unset, derived deterministically from `SESSION_SECRET`. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FRONTEND_ORIGIN` | ⬜ | Where the browser lands after login (`/` in single-origin prod; `http://localhost:5173` in dev). |
| `PORT` | ⬜ | Listen port (Railway injects this automatically). Default `3000`. |
| `NODE_ENV` | ⬜ | Set to `production` on Railway. |

> Rotation note: because the encryption key is derived from `SESSION_SECRET` by default, rotating `SESSION_SECRET` invalidates sessions *and* makes stored GitHub tokens unreadable until the user logs in again. For long-lived tokens, set `ENCRYPTION_KEY` explicitly.

## Database schema

Four models (`backend/prisma/schema.prisma`): `User`, `Repo`, `PullRequest`, `Reviewer`.

- GitHub-provided ids are unique constraints (`github_id`, `github_repo_id`, `github_pr_id`), so upserts are idempotent.
- Composite indexes lead with `repo_id`, then a date column (`opened_at`, `first_review_at`, `merged_at`, `closed_at`) — the shape you want for per-repo time-range queries like "average time to first review last month".
- `@@unique([owner, name])` on `Repo` prevents duplicate connections.

Migrations live in `backend/prisma/migrations/` and are applied on deploy via `prisma migrate deploy` (in the Dockerfile `CMD`).

## Deploying: Render (hosting) + Neon (Postgres)

Both have permanent free tiers with **no credit card required**. The app is a
**single origin** — the Dockerfile builds the frontend and the backend serves it —
so there is exactly **one public URL** (`https://<service-name>.onrender.com`),
which is what we register with GitHub for OAuth callbacks and (later) webhooks.

### 1. Neon — free Postgres

1. Sign in at [neon.tech](https://neon.tech) with your GitHub account (Free plan, no card).
2. **Create a project**: name `repopulse`, pick a region near you, accept the default database name (`neondb`) or call it `repopulse`.
3. The project dashboard shows a **connection string**. Copy it — it looks like:
   `postgresql://neondb_owner:xxxx@ep-...-....us-east-1.aws.neon.tech/neondb?sslmode=require`
   (keep the `?sslmode=require` — Neon requires TLS and Prisma needs it in the URL).
   This is your `DATABASE_URL`, valid for both production *and* local dev.

> ⚠️ **Neon connection string:** use the *direct* endpoint from the dashboard (the default `ep-…aws.neon.tech` host), not the `-pooler` one. Prisma manages its own pool for a single service.

> **Free-tier note:** Neon free projects pause after ~5 days of inactivity. If local dev later hangs on `prisma` errors, reopen your stale branch or start the project from the Neon dashboard first.

### 2. Render — free Web Service

1. Push this repo to GitHub (`abisha-ch/RepoPulse` is the existing name).
2. Sign in at [render.com](https://render.com) with GitHub, and grant access to the repo.
3. Dashboard → **New → Web Service** → connect the `RepoPulse` repo.
4. Settings:
   - **Name**: `repopulse` → your URL becomes `https://repopulse.onrender.com` (if taken, pick another — use whatever URL it gives you).
   - **Environment**: **Docker** (Render builds `Dockerfile` from the repo root; `render.yaml` is included for the Blueprint route but manual setup is identical).
   - **Region**: nearest to you.
   - **Branch**: `main`.
   - **Plan**: Free.
5. Leave Build/Start Commands blank (they come from the Dockerfile).
6. Under **Environment**, set the variables from the table below, then **Create Web Service**.

> The `render.yaml` in the repo documents all of this. You can deploy via Dashboard → **New → Blueprint** instead, which reads it automatically.

> ⚠️ **Free-tier spin-down:** Render free services sleep after 15 min of inactivity and take ~30–60 s to wake. Fine for testing OAuth/demo work; **not reliable for GitHub webhooks** (a hook that arrives while asleep waits too long and GitHub times out). When you wire real webhooks (Day 2+), either use a [cron/keep-alive job](https://render.com/docs/cronjobs) on a paid instance or upgrade to a Starter instance that stays awake. GitHub retries webhooks for a limited window, so missed deliveries are mostly *watched* by the retry loop if the service returns 503, but plan for keeping it awake.

### 3. Environment variables (set in Render → Environment)

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | Your Neon connection string from step 1 (with `?sslmode=require`) |
| `GITHUB_CLIENT_ID` | OAuth App client ID (your GitHub App — see below) |
| `GITHUB_CLIENT_SECRET` | OAuth App client secret |
| `SESSION_SECRET` | Any long random hex. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `GITHUB_REDIRECT_URI` | `https://repopulse.onrender.com/auth/github/callback` (your actual URL — set after first deploy) |
| `ENCRYPTION_KEY` | Optional: 64-hex-char key; derived from `SESSION_SECRET` if unset |

### 4. Verify + wire OAuth

1. After deploy, check `https://repopulse.onrender.com/health` → `{"ok":true}` and that the homepage loads.
2. On your GitHub OAuth App (github.com → Settings → Developer settings):

   | Field | Value |
   | --- | --- |
   | Homepage URL | `https://repopulse.onrender.com` |
   | Authorization callback URL | `https://repopulse.onrender.com/auth/github/callback` |

3. Make sure `GITHUB_REDIRECT_URI` in Render matches the callback URL exactly.
4. Open the homepage in a **private window** and complete a real GitHub login → you should see “Logged in as {username}”.

If the URL that Render assigned differs from `repopulse.onrender.com`, substitute it everywhere above.

## Layout

```
backend/           Express + TypeScript API
  prisma/          schema + SQL migrations
  src/
    auth/          OAuth routes, session (JWT), auth middleware
    crypto/        AES-256-GCM token encryption
    routes/        /me
    app.ts         Express app (serves frontend/dist)
    index.ts       entry point
frontend/          Vite + React SPA (placeholder login UI)
Dockerfile         multi-stage build for Render (Docker environment)
render.yaml        Render Blueprint (or set it up manually in the dashboard)
```