# RepoPulse 📊

> **GitHub Engineering Health & Velocity Dashboard**  
> Measure pull-request cycle times, review latency, contributor concentration, and workflow health with on-demand GitHub synchronization.

---

<!-- SCREENSHOT / DEMO PLACEHOLDER -->
<!--
  Capture a quick screenshot or GIF of the RepoPulse dashboard with synced repository metrics:
  ![RepoPulse Dashboard Preview](docs/screenshots/dashboard-preview.png)
-->

---

## 🌟 Why RepoPulse?

Software engineering teams often struggle with invisible bottlenecks in their delivery pipeline:
- **Delayed Code Reviews:** PRs sitting idle waiting for peer attention, slowing down feature velocity.
- **Long Merge Lifecycles:** Friction in CI/CD, review cycles, or branch management leading to stale branches and painful merge conflicts.
- **Knowledge Silos & Bus Factor Risk:** Disproportionate dependency on a single contributor for the majority of merged changes.
- **Stale PR Accumulation:** Abandoned or forgotten PRs bloating the repository backlog.

**RepoPulse** connects to your GitHub repositories, aggregates Pull Request and Review timelines, and computes actionable engineering health metrics in real time.

---

## 🚀 Key Features

- 🔐 **GitHub OAuth 2.0 & Token Security:** Secure authorization code flow with session tokens and AES-256-GCM encryption for stored GitHub access tokens at rest.
- 🔄 **On-Demand PR & Review Sync:** Multi-page pagination pulling pull requests and reviewer histories directly from the GitHub REST API.
- ⏱️ **Rate-Limit Resilience:** Batch-controlled review fetching (5 concurrent workers) and structured 429 rate limit backoff handling with live reset countdowns.
- 📊 **Core Engineering Health Metrics:**
  - ⏱️ **Avg Time to First Review:** Duration from PR opening to the earliest non-author review.
  - 🚀 **Avg Time to Merge:** Duration from PR opening to merge timestamp.
  - ⚠️ **Stale Open PRs:** Real-time tracking of pull requests open for more than 7 days without merging.
  - 👥 **Bus Factor / PR Author Concentration:** Quantifies knowledge distribution (% of merged PRs authored by top contributors) categorized as High, Moderate, or Low risk.
- 📋 **Pull Request Activity Table:** Tabular breakdown of recent PRs with statuses, review timings, merge times, and contributor identities.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend** | Node.js, Express 5, TypeScript | REST API, GitHub client, metric compute engines |
| **Database** | PostgreSQL, Prisma ORM | Relational storage for users, repos, PRs, and reviewers |
| **Frontend** | React 19, Vite, TypeScript | Fast single-page application with responsive dark/light theme |
| **Auth & Security** | JWT (httpOnly cookie), AES-256-GCM | Encrypted token storage and anti-CSRF OAuth state verification |
| **Deployment** | Docker (Multi-stage build) | Production container bundling backend and static frontend |

---

## 📐 Architecture & Single-Origin Design

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

This single-origin model eliminates cross-origin cookie issues and makes authentication work seamlessly across `localhost`, ngrok tunnels, and production URLs.

---

## 💻 Local Development Setup

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
| `DATABASE_URL` | ✅ | PostgreSQL connection string | `postgresql://user:pass@ep-xyz.aws.neon.tech/repopulse?sslmode=require` |
| `GITHUB_CLIENT_ID` | ✅ | GitHub OAuth App Client ID | `Ov23li...` |
| `GITHUB_CLIENT_SECRET` | ✅ | GitHub OAuth App Client Secret | `4a8f...` |
| `SESSION_SECRET` | ✅ | Random key for signing session JWTs | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `GITHUB_REDIRECT_URI` | ⬜ | OAuth callback URL | `http://localhost:3000/auth/github/callback` (or your ngrok / prod URL) |
| `ENCRYPTION_KEY` | ⬜ | 32-byte (64 hex chars) key for AES-256 token encryption | Derived from `SESSION_SECRET` if omitted |
| `PORT` | ⬜ | Backend server listen port | `3000` |
| `NODE_ENV` | ⬜ | Runtime environment | `development` (or `production`) |

### 3. Register a GitHub OAuth App
1. Go to **[GitHub Developer Settings → OAuth Apps → New OAuth App](https://github.com/settings/applications/new)**.
2. Fill in:
   - **Application name:** `RepoPulse (Local)`
   - **Homepage URL:** `http://localhost:3000` (or `http://localhost:5173` if running Vite dev server)
   - **Authorization callback URL:** `http://localhost:3000/auth/github/callback`
3. Copy the **Client ID** and generate a **Client Secret**, then paste them into `backend/.env`.

### 4. Initialize Database Schema
Run Prisma migrations to create the database tables and generate the typed client:
```bash
npm run db:generate -w backend
npm run db:migrate -w backend
```

### 5. Start Development Servers
- **Backend API (Port 3000):**
  ```bash
  npm run dev -w backend
  ```
- **Frontend SPA with Hot Module Replacement (Port 5173):**
  ```bash
  npm run dev -w frontend
  ```
  *(Note: The Vite dev server proxies all `/auth`, `/me`, `/repos`, and `/user` requests to `:3000` automatically).*

Open **[http://localhost:5173](http://localhost:5173)** in your browser.

---

## 📡 API Reference

| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/health` | No | Basic healthcheck endpoint returning `{ ok: true }` |
| `GET` | `/auth/github/login` | No | Initiates GitHub OAuth authorization flow |
| `GET` | `/auth/github/callback` | No | Exchanges OAuth code, upserts user with encrypted token, sets session cookie |
| `POST` | `/auth/github/logout` | No | Clears user session cookie |
| `GET` | `/me` | Yes | Returns authenticated user profile |
| `GET` | `/user/github-repos` | Yes | Lists accessible repositories from user's GitHub account for autocomplete |
| `GET` | `/repos` | Yes | Lists repositories connected by the user in RepoPulse |
| `POST` | `/repos` | Yes | Connects a repository (`{ owner, name }` or `{ repo: "owner/name" }`) |
| `POST` | `/repos/:id/sync` | Yes | On-demand sync of PRs and reviews from GitHub REST API |
| `GET` | `/repos/:id/metrics` | Yes | Returns computed engineering velocity & health metrics for a repository |

---

## ⚠️ Known Limitations & Methodological Tradeoffs

1. **Manual On-Demand Sync (Webhooks Pending):**
   - Repository data updates when the user triggers **Sync Now** in the dashboard. Automatic real-time ingestion via GitHub Webhooks is deferred to a future milestone.
2. **Bus Factor Approximation via PR Author Concentration:**
   - Bus factor is approximated using the proportion of merged PRs authored by top contributors (Top 1 and Top 2 share).
   - *Tradeoff:* True file-by-file line-level blame analysis requires deep git tree clones and heavy CPU overhead. Measuring PR author concentration gives an immediate, lightweight operational indicator of key contributor dependencies without heavy infrastructure.
3. **Review Latency Measurement:**
   - Time to first review evaluates the earliest review timestamp submitted by a peer (excluding self-reviews by the PR author). If a PR was reviewed via issue comments rather than formal GitHub Pull Request Review submissions, it is recorded once a review object exists.
4. **Free Tier Hosting Sleep Cycle:**
   - On free platforms (e.g., Render), instances spin down after 15 minutes of inactivity and take ~30 seconds to wake up on the first request.

---

## 🚢 Deployment Guide

RepoPulse is pre-configured with a multi-stage `Dockerfile` and `render.yaml` blueprint for zero-cost deployment using **Render** (free Web Service) and **Neon** (free serverless PostgreSQL).

See the [Deployment Section](docs/DEPLOYMENT.md) for detailed cloud configuration steps.
