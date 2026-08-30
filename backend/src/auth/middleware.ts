import type { NextFunction, Request, Response } from 'express';
import { readSession } from './session';

/** Protect a route: 401 unless a valid session JWT is present. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  req.userId = session.userId;
  next();
}