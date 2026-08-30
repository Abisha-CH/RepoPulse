import cookieParser from 'cookie-parser';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { githubAuthRouter } from './auth/oauth';
import { meRouter } from './routes/me';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/auth/github', githubAuthRouter);
  app.use(meRouter);

  // Single origin: the backend serves the built React app so cookies and OAuth
  // callbacks share one host. The catch-all is a plain middleware (Express 5
  // dropped app.get('*')) and only serves index.html for non-API GETs.
  // Resolve relative to this file so it works from any working directory
  // (dev via tsx: backend/src → ../../frontend/dist; prod: backend/dist → ../../frontend/dist).
  const frontendDist = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/auth') || req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('text/plain')
        .send('RepoPulse backend is running. Build the frontend (npm run build -w frontend) to serve the UI.');
    });
  }

  return app;
}