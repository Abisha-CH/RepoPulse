import jwt from 'jsonwebtoken';
import type { CookieOptions, Request, Response } from 'express';
import { config } from '../config';

export const SESSION_COOKIE = 'repopulse_session';
export const OAUTH_STATE_COOKIE = 'repopulse_oauth_state';

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const JWT_ISSUER = 'repopulse';

/**
 * Shared cookie options for both the session cookie and the OAuth state cookie.
 * Omit `domain` so the browser treats it as a host-only cookie for the current host,
 * which allows the cookie to work seamlessly across localhost, ngrok tunnels, and prod.
 */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd || config.appUrl.startsWith('https:'),
    domain: undefined,
    path: '/',
  };
}

export function signSession(userId: string): string {
  return jwt.sign({ sub: userId }, config.sessionSecret, { expiresIn: '7d', issuer: JWT_ISSUER });
}

export function issueSessionCookie(res: Response, userId: string): void {
  res.cookie(SESSION_COOKIE, signSession(userId), {
    ...sessionCookieOptions(),
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function readSession(req: Request): { userId: string } | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    return null;
  }
  try {
    const payload = jwt.verify(token, config.sessionSecret, { issuer: JWT_ISSUER });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      return null;
    }
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}