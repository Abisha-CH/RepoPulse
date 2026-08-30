import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config';
import { prisma } from '../db';
import { encryptToken } from '../crypto/token';
import { clearSessionCookie, issueSessionCookie, OAUTH_STATE_COOKIE, sessionCookieOptions } from './session';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';
const SCOPES = 'read:user user:email';
const STATE_TTL_MS = 10 * 60 * 1000;
const USER_AGENT = 'RepoPulse';

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUserResponse {
  id: number;
  login: string;
  email: string | null;
}

export const githubAuthRouter = Router();

/** Step 1 — redirect the browser to GitHub's authorization screen. */
githubAuthRouter.get('/login', (_req, res) => {
  const state = randomBytes(32).toString('hex');
  res.cookie(OAUTH_STATE_COOKIE, state, { ...sessionCookieOptions(), maxAge: STATE_TTL_MS });

  const params = new URLSearchParams({
    client_id: config.githubClientId,
    redirect_uri: config.githubRedirectUri,
    scope: SCOPES,
    state,
  });
  res.redirect(`${GITHUB_AUTHORIZE_URL}?${params.toString()}`);
});

/** Step 2 — GitHub redirects back here with ?code=...&state=... */
githubAuthRouter.get('/callback', async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };

  if (typeof code !== 'string' || typeof state !== 'string') {
    res.status(400).json({ error: 'OAuth callback missing code or state.' });
    return;
  }

  // Anti-CSRF: the state in the callback must match the cookie we issued.
  const expectedState = req.cookies?.[OAUTH_STATE_COOKIE];
  if (typeof expectedState !== 'string' || !timingSafeCompare(state, expectedState)) {
    res.status(400).json({ error: 'OAuth state mismatch.' });
    return;
  }
  res.clearCookie(OAUTH_STATE_COOKIE, sessionCookieOptions());

  let accessToken: string;
  try {
    accessToken = await exchangeCodeForToken(code);
  } catch (err) {
    res.status(502).json({ error: `Failed to exchange OAuth code: ${errorMessage(err)}` });
    return;
  }

  let ghUser: GitHubUserResponse;
  try {
    ghUser = await fetchGitHubUser(accessToken);
  } catch (err) {
    res.status(502).json({ error: `Failed to fetch GitHub profile: ${errorMessage(err)}` });
    return;
  }

  // GitHub rarely returns the email on /user; the primary verified one comes from /user/emails.
  const email = await fetchPrimaryEmail(accessToken, ghUser.email);

  const user = await prisma.user.upsert({
    where: { github_id: ghUser.id },
    update: { username: ghUser.login, email, access_token: encryptToken(accessToken) },
    create: { github_id: ghUser.id, username: ghUser.login, email, access_token: encryptToken(accessToken) },
  });

  issueSessionCookie(res, user.id);
  res.redirect(config.frontendOrigin);
});

/** Step 3 — Log out current user and clear session cookie */
githubAuthRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

async function exchangeCodeForToken(code: string): Promise<string> {
  const resp = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: config.githubRedirectUri,
    }),
  });
  if (!resp.ok) {
    throw new Error(`GitHub token endpoint returned ${resp.status}.`);
  }
  const data = (await resp.json()) as GitHubTokenResponse;
  if (!data.access_token) {
    throw new Error(data.error_description ?? data.error ?? 'No access_token in response.');
  }
  return data.access_token;
}

async function fetchGitHubUser(token: string): Promise<GitHubUserResponse> {
  const resp = await fetch(`${GITHUB_API_URL}/user`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
  });
  if (!resp.ok) {
    throw new Error(`GitHub /user returned ${resp.status}.`);
  }
  return (await resp.json()) as GitHubUserResponse;
}

async function fetchPrimaryEmail(token: string, profileEmail: string | null): Promise<string | null> {
  interface EmailRecord {
    email: string;
    primary: boolean;
    verified: boolean;
  }
  let resp: Response;
  try {
    resp = await fetch(`${GITHUB_API_URL}/user/emails`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
    });
  } catch {
    return profileEmail;
  }
  if (!resp.ok) {
    return profileEmail;
  }
  const emails = (await resp.json()) as EmailRecord[];
  const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.email === profileEmail);
  return primary?.email ?? profileEmail;
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}