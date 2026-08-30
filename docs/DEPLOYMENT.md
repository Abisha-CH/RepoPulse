# RepoPulse Deployment Guide

This guide covers deploying RepoPulse to **Render** (free Web Service) with **Neon** (free serverless PostgreSQL). Both services offer permanent free tiers with no credit card required.

---

## 1. Database Setup (Neon PostgreSQL)

1. Sign up / Log in at [neon.tech](https://neon.tech) using your GitHub account (Free plan).
2. Click **Create a project**:
   - **Project Name:** `repopulse`
   - **Region:** Select the region closest to your users / hosting region.
   - **Database Name:** `repopulse` (or leave default `neondb`).
3. Copy the **Connection String** from the dashboard:
   ```
   postgresql://[user]:[password]@[endpoint].us-east-1.aws.neon.tech/repopulse?sslmode=require
   ```
   *(Ensure `?sslmode=require` is present at the end of the URL).*

---

## 2. Web Service Setup (Render)

1. Sign up / Log in at [render.com](https://render.com) using your GitHub account.
2. Ensure your repository (`Abisha-CH/RepoPulse`) is pushed to GitHub.
3. Click **New +** → **Web Service**.
4. Select **Build and deploy from a Git repository** and connect `RepoPulse`.
5. Configure the deployment settings:
   - **Name:** `repopulse` (your public URL will be `https://repopulse.onrender.com` or similar)
   - **Region:** Match your Neon database region if possible (e.g., US East)
   - **Branch:** `main` (or `master`)
   - **Runtime:** **Docker** (Render automatically picks up the `Dockerfile` from the repo root)
   - **Instance Type:** **Free** ($0/month)
6. Under **Environment Variables**, add:

| Key | Value |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | Your Neon connection string (with `?sslmode=require`) |
| `GITHUB_CLIENT_ID` | Your GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | Your GitHub OAuth App Client Secret |
| `SESSION_SECRET` | 64+ random hex characters (generate via `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| `GITHUB_REDIRECT_URI` | `https://<your-service-name>.onrender.com/auth/github/callback` |
| `ENCRYPTION_KEY` | *(Optional)* 32-byte hex key for AES-256 token encryption |

7. Click **Deploy Web Service**.

---

## 3. Configure GitHub OAuth App

Once Render creates your service and gives you your live URL (e.g. `https://repopulse-xyz.onrender.com`):

1. Navigate to **[GitHub Developer Settings → OAuth Apps](https://github.com/settings/developers)**.
2. Select your OAuth App (or create a dedicated production one):
   - **Homepage URL:** `https://<your-service-name>.onrender.com`
   - **Authorization callback URL:** `https://<your-service-name>.onrender.com/auth/github/callback`
3. If the URL assigned by Render is different from what you set initially, update `GITHUB_REDIRECT_URI` in the Render Environment Variables and redeploy.

---

## 4. Verification

1. Test health check endpoint: `https://<your-service-name>.onrender.com/health` → `{"ok":true}`.
2. Open the main page in an incognito window and log in with GitHub.
3. Connect a repository and run **Sync Now** to verify real-time metric calculation in production.
