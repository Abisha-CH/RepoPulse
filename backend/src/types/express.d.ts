import 'express';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth() from the session JWT. */
      userId?: string;
    }
  }
}

export {};