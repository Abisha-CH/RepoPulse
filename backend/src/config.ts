import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

export const config = {
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3000),

  githubClientId: required('GITHUB_CLIENT_ID'),
  githubClientSecret: required('GITHUB_CLIENT_SECRET'),
  githubRedirectUri: optional('GITHUB_REDIRECT_URI', 'http://localhost:3000/auth/github/callback'),

  // Where to send the browser after a successful OAuth callback.
  // Single-origin prod: '/' resolves to the same deployment. Development uses the Vite server.
  frontendOrigin: optional('FRONTEND_ORIGIN', '/'),

  sessionSecret: required('SESSION_SECRET'),

  // Optional explicit 32-byte key for encrypting GitHub tokens. If unset, one is
  // derived deterministically from SESSION_SECRET so there is a single secret to rotate.
  encryptionKey: optional('ENCRYPTION_KEY', ''),

  databaseUrl: required('DATABASE_URL'),
} as const;