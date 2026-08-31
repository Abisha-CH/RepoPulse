# RepoPulse

> **GitHub Engineering Health & Velocity Dashboard**
> Measure pull-request cycle times, review latency, contributor concentration, and workflow health with on-demand GitHub synchronization.

---

![RepoPulse Dashboard — Engineering Health Metrics](screenshots/dashboard-metrics.png)

## Why RepoPulse?

Software engineering teams often struggle with invisible bottlenecks in their delivery pipeline:

- **Delayed Code Reviews** — PRs sitting idle, slowing feature velocity.
- **Long Merge Lifecycles** — friction in CI/CD or review cycles leading to stale branches and painful conflicts.
- **Knowledge Silos** — disproportionate dependency on a single contributor for most merged changes.
- **Stale PR Accumulation** — abandoned or forgotten PRs bloating the backlog.

RepoPulse connects to your GitHub repositories, aggregates Pull Request and Review timelines, and computes actionable engineering health metrics in real time.

---

## Key Features

- **GitHub OAuth 2.0 & Token Security** — Secure authorization code flow with session tokens and AES-256-GCM encryption for stored GitHub access tokens at rest.
- **On-Demand PR & Review Sync** — Multi-page pagination pulling pull requests and reviewer histories directly from the GitHub REST API.
- **Rate-Limit Resilience** — Batch-controlled review fetching (10 concurrent workers) and structured 429 rate-limit backoff with live reset countdowns.
- **Core Engineering Health Metrics:**
  - Average time to first review, average time to merge, stale open PRs, and bus factor / contributor concentration.

  ![Contributor Breakdown](screenshots/contributor-breakdown.png)

- **Pull Request Activity Table** — Tabular breakdown of recent PRs with statuses, review timings, merge times, and contributor identities.

  ![Pull Request Table](screenshots/pr-table.png)

- **CI Failure Rate by PR Size** — Reveals whether larger PRs fail CI checks more often than smaller ones. PRs are bucketed by total lines changed into three size categories (Small < 100, Medium 100–499, Large ≥ 500 lines). CI status is fetched per PR via the GitHub Checks API (`GET /repos/{owner}/{repo}/commits/{sha}/check-runs?filter=latest`) on each PR's head commit.

  **CI status definitions:**
  | Status | Meaning |
  | :--- | :--- |
  | **Failure** | At least one completed check run concluded `failure`, `timed_out`, or `action_required` |
  | **Passing** | At least one completed run, none failed or still running |
  | **Pending** | At least one run still `queued` or `in_progress` |
  | **Unknown (null)** | No check runs configured (legacy or non-Actions CI); excluded from the failure-rate denominator |

  ![CI Failure Rate by PR Size](screenshots/ci.png)

- **AI Insights (Gemini)** — An AI layer that analyzes a repo's metrics and returns evidence-backed observations with severity ratings and concrete recommendations. Powered by **Gemini 3.6 Flash**, results are cached per repo so Gemini is only called when data changes or you explicitly regenerate.

  ![AI Insights](screenshots/ai-insights.png)

- **Engineering Health Report** — A polished, shareable summary with overall health score, 4 sub-category scores, cached AI insights, and print-to-PDF export.

- **Public Repo Leaderboard** — A login-free page (`/leaderboard`) ranking every synchronized repository by an overall health score (0–100), with color-coded scores and underlying metrics.

  ![Public Repo Leaderboard](screenshots/leaderboard-1.png)

---

## Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend** | Node.js, Express 5, TypeScript | REST API, GitHub client, metric compute engines |
| **Database** | PostgreSQL, Prisma ORM | Relational storage for users, repos, PRs, and reviewers |
| **Frontend** | React 19, Vite, TypeScript | Fast single-page application with responsive dark/light theme |
| **Auth & Security** | JWT (httpOnly cookie), AES-256-GCM | Encrypted token storage and anti-CSRF OAuth state verification |
| **Deployment** | Docker (multi-stage build) | Production container bundling backend and static frontend |

---

## Architecture & Single-Origin Design

RepoPulse is structured as an npm monorepo (`backend` and `frontend` workspaces). In production, the Express backend serves the pre-built React frontend as static assets from `frontend/dist`.

```
Browser ── /auth/github/login ──▶ GitHub ──?code=...──▶ /auth/github/callback
                                                          │  exchange code for token
                                                          │  GET api.github.com/user
                                                          │  upsert User (AES-256 encrypted token)
                                                          ▼
                                                     Set-Cookie repopulse_session=JWT
                                                     redirect ──▶ / (Dashboard SPA)
```

![GitHub OAuth Login](screenshots/login.png)

This single-origin model eliminates cross-origin cookie issues and makes authentication work seamlessly across `localhost`, ngrok tunnels, and production URLs.

---

## Local Development Setup

### Prerequisites

- **Node.js**: v20 or newer
- **npm**: v9 or newer
- **PostgreSQL**: Local instance or a free cloud instance (e.g., [Neon](https://neon.tech))

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/Abisha-CH/RepoPulse.git
cd RepoPulse
npm install
```

### 2. Configure Environment Variables

Create `backend/.env` based on the template:

```bash
cp backend/.env.example backend/.env
```

Set the required environment variables:

| Variable | Required | Description | Example / Default |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | Yes | PostgreSQL connection string (**direct endpoint** — do not use Neon's `-pooler` suffix or PgBouncer) | `postgresql://user:pass@ep-xyz.us-east-2.aws.neon.tech/repopulse?sslmode=require` |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth App Client ID | `Ov23li...` |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth App Client Secret | `4a8f...` |
| `SESSION_SECRET` | Yes | Random key for signing session JWTs | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `GITHUB_REDIRECT_URI` | No | OAuth callback URL | `http://localhost:3000/auth/github/callback` |
| `ENCRYPTION_KEY` | No | 32-byte (64 hex chars) key for AES-256 token encryption | Derived from `SESSION_SECRET` if omitted |
| `SLACK_WEBHOOK_URL` | No | Incoming Webhook URL for the Slack Digest feature. [Create one here](https://api.slack.com/messaging/webhooks). | `https://hooks.slack.com/services/T000/B000/XXXX` |
| `GEMINI_API_KEY` | No | Google Gemini API key for AI Insights. [Get one here](https://aistudio.google.com/apikey). | `AIza...` |
| `PORT` | No | Backend server listen port | `3000` |
| `NODE_ENV` | No | Runtime environment | `development` |

### 3. Register a GitHub OAuth App

1. Go to [GitHub Developer Settings → OAuth Apps → New OAuth App](https://github.com/settings/applications/new).
2. Fill in:
   - **Application name:** `RepoPulse (Local)`
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000/auth/github/callback`
3. Copy the **Client ID** and generate a **Client Secret**, then paste them into `backend/.env`.

### 4. Initialize Database Schema

```bash
npm run db:generate -w backend
npm run db:migrate -w backend
```

### 5. Start Development Servers

**Backend API (Port 3000):**

```bash
npm run dev -w backend
```

**Frontend SPA with Hot Module Replacement (Port 5173):**

```bash
npm run dev -w frontend
```

> The Vite dev server proxies all API requests (`/auth`, `/me`, `/repos`, `/user`, `/public`) to `:3000` automatically.

Open **[http://localhost:5173](http://localhost:5173)** in your browser.

---

## API Reference

| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/health` | No | Healthcheck endpoint returning `{ ok: true }` |
| `GET` | `/auth/github/login` | No | Initiates GitHub OAuth authorization flow |
| `GET` | `/auth/github/callback` | No | Exchanges OAuth code, upserts user with encrypted token, sets session cookie |
| `POST` | `/auth/github/logout` | No | Clears user session cookie |
| `GET` | `/me` | Yes | Returns authenticated user profile |
| `GET` | `/user/github-repos` | Yes | Lists accessible repositories from user's GitHub account |
| `GET` | `/repos` | Yes | Lists repositories connected by the user |
| `POST` | `/repos` | Yes | Connects a repository (`{ owner, name }` or `{ repo: "owner/name" }`) |
| `POST` | `/repos/:id/sync` | Yes | On-demand sync of PRs and reviews from GitHub REST API |
| `GET` | `/repos/:id/metrics` | Yes | Returns computed engineering velocity & health metrics |
| `POST` | `/repos/:id/send-digest` | Yes | Formats metrics as a Slack message and posts to configured webhook |
| `GET` | `/repos/:id/insights` | Yes | Returns AI insights (cached if fresh, otherwise generates via Gemini) |
| `POST` | `/repos/:id/insights/regenerate` | Yes | Forces a fresh Gemini analysis, ignoring any cached insight |
| `GET` | `/repos/:id/health-report` | Yes | Assembled engineering health report with overall score, sub-categories, and cached AI insights |
| `GET` | `/public/leaderboard` | No | Public ranking of all synced public repos by health score |

---

## Slack Digest

Push a repository's current engineering-health metrics straight to your team's Slack channel with one click. The **Send Digest to Slack** button reuses the same `computeRepoMetrics()` numbers shown on the dashboard, formats them into a Slack Block Kit message, and posts them to your configured Incoming Webhook.

![Weekly Digest in Slack](screenshots/slack-digest.png)

**To enable it:**

1. Create an [Incoming Webhook](https://api.slack.com/messaging/webhooks) for your channel.
2. Add its URL as `SLACK_WEBHOOK_URL` in `backend/.env`.
3. Open the dashboard, select a repository, and click **Send Digest to Slack**.

If `SLACK_WEBHOOK_URL` is not set, the button returns a clear configuration error. The digest reflects a repo's current metrics — run **Sync Now** first to refresh from GitHub before sending.

---

## AI Insights

The AI Insights panel reads a repo's computed engineering-health numbers and summarizes what they mean — trends, risks, and positive signals. It is powered by **Google Gemini 3.6 Flash**.

**How it works:**

1. The backend reuses the same `computeRepoMetrics()` numbers shown on the dashboard.
2. A curated, evidence-only snapshot of those metrics is sent to Gemini with a strict system prompt: only cite supplied metrics, never invent facts, return 2–4 observations, no blame, no generic filler.
3. Gemini returns structured JSON (finding / evidence / recommendation / severity), which the backend defensively parses and validates — bad severities, missing fields, empty arrays, and code-fenced output are all handled gracefully.
4. The result is cached in the `insights` table keyed to the repo's PR count snapshot at generation time.

**Caching & staleness:** Each insight stores the repo's total PR count at generation time. When a sync adds or removes PRs, the cache is considered stale and the next dashboard load regenerates it automatically. The **Regenerate** button (`POST /repos/:id/insights/regenerate`) forces a fresh Gemini call on demand.

**Enable it:** Add `GEMINI_API_KEY` to `backend/.env`. The key is server-side only and never exposed to the frontend. Without a key, the panel shows a friendly "not configured" message.

---

## Engineering Health Report

The **Health Report** button generates a polished, shareable summary of a repository's engineering health.

**What it includes:**

- **Overall Health Score** (0–100), displayed as a circular gauge
- **4 Sub-Category Scores**, each with a visual progress bar:
  - **Delivery Velocity** — average time to merge
  - **Review Process** — review latency combined with stale PR rate
  - **Knowledge Distribution** — bus factor / contributor concentration
  - **CI Reliability** — CI check failure rate
- **Top Risks & Recommendations** — cached AI Insights observations (no new Gemini calls)
- **Repository Summary** — total, open, merged, and closed PR counts

The endpoint (`GET /repos/:id/health-report`) computes metrics and the health score using the same functions powering the dashboard and leaderboard, and pulls the most recently cached AI Insights from the database. No new external API calls or database writes are made.

**Export:** The report view includes a **Print / Export PDF** button that uses the browser's native print-to-PDF functionality with print-optimized CSS.

---

## Public Repo Leaderboard

The leaderboard at `/leaderboard` (linked from the dashboard header and the login screen) ranks every **public** repository that has ever been synced by any user by an overall engineering health score.

**Privacy:** Only repos GitHub reports as public appear. Repo visibility (`public`/`private`) is captured from the GitHub API at connect time and refreshed on every sync; private repos are filtered out entirely at the query level. The leaderboard is reachable without authentication and exposes only aggregate, repo-level data — no emails, usernames, tokens, or anything tied to an individual user account.

### Health Score Formula (0–100)

Every component is *"lower is better"* — each raw metric is normalized linearly onto a 0–100 sub-score between its "best" and "worst" anchors, then combined as a weighted average. The normalization anchors are defined in `backend/src/metrics/health.ts`.

| Component | Weight | Best (100 pts) | Worst (0 pts) | What it measures |
| :--- | :---: | :---: | :---: | :--- |
| **Time to Merge** | 30% | ≤ 8h | ≥ 168h (7 days) | Avg time from PR open to merge |
| **Stale Open PRs** | 25% | 0% | ≥ 50% | Share of open PRs idle for 7+ days |
| **Bus Factor** | 20% | ≤ 40% | 100% | Top-2 author share of merged PRs |
| **CI Failure Rate** | 25% | 0% | ≥ 40% | Overall PR check failure rate |

**Missing-data handling:** When a repo has no data for a component, that component is excluded — its weight is dropped from both sides and the remaining weights are renormalized automatically. A repo with no synced PR data at all gets `score: null` and appears below the scored repos.

---

## Known Limitations & Methodological Tradeoffs

1. **Manual On-Demand Sync:** Repository data updates when the user triggers **Sync Now**. Automatic real-time ingestion via GitHub Webhooks is deferred to a future milestone.
2. **Bus Factor Approximation:** Approximated using the proportion of merged PRs authored by top contributors (Top 1 and Top 2 share). This gives a lightweight operational indicator without requiring deep git line-level blame analysis.
3. **Review Latency Measurement:** Time to first review evaluates the earliest review timestamp from a peer (excluding self-reviews). If a PR was reviewed via issue comments rather than formal GitHub Pull Request Reviews, it is recorded once a review object exists.
4. **Free Tier Hosting Sleep Cycle:** On free platforms (e.g., Render), instances spin down after 15 minutes of inactivity and take ~30 seconds to wake up on the first request.
5. **Sync Latency (Remote PostgreSQL):** For large repos (~200 PRs), sync completes in roughly **80–85 seconds** wall-time: GitHub fetch ≈ 5s, review fetch (10 concurrent) ≈ 12–14s, DB write ≈ 65–70s. The write phase is sequential because Prisma's interactive `$transaction(callback)` has a hard 5s timeout incompatible with ~200 sequential remote round-trips.
6. **Neon Pooler / Prisma `$transaction` Constraint:** `DATABASE_URL` **must use Neon's direct (non-pooler) endpoint**. Prisma's interactive `$transaction(callback)` routes each statement independently; over PgBouncer-style poolers, statements can land on different connections, producing `P2028: Transaction not found` errors. If the app ever requires pooling, the sync write loop must use per-PR array-form `$transaction([...])` exclusively.

---

## Future Roadmap

Planned improvements and features not yet implemented:

- **Scheduled Slack Digests** — Drive the digest function with a scheduler (e.g., `node-cron`) to post a weekly digest automatically, rather than requiring a manual button click. See `backend/src/slack/digest.ts`.
- **Scheduled AI Insights** — A periodic job that calls `generateInsights()` for each synced repo and persists the result, so the cache stays fresh without requiring a dashboard visit. See `backend/src/insights/generate.ts` and `backend/src/routes/insights.ts`.
- **GitHub Webhooks** — Automatic real-time PR and review ingestion instead of on-demand sync.
- **Bulk Batched DB Writes** — The per-PR sequential upsert is the dominant cost in sync wall-time. A future optimization could batch upserts via `createMany({ skipDuplicates: true })` and chunk reviewer writes in array-form transactions, reducing remote-DB round-trips while remaining pooler-safe.

---

## Deployment Guide

RepoPulse is pre-configured with a multi-stage `Dockerfile` and `render.yaml` blueprint for zero-cost deployment using **Render** (free Web Service) and **Neon** (free serverless PostgreSQL).

See the [Deployment Guide](docs/DEPLOYMENT.md) for detailed cloud configuration steps.
