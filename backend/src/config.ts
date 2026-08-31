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

const rawAppUrl = optional('APP_URL', optional('PUBLIC_URL', 'http://localhost:3000')).replace(/\/+$/, '');

export const config = {
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3000),
  appUrl: rawAppUrl,

  githubClientId: required('GITHUB_CLIENT_ID'),
  githubClientSecret: required('GITHUB_CLIENT_SECRET'),
  githubRedirectUri: optional('GITHUB_REDIRECT_URI', `${rawAppUrl}/auth/github/callback`),

  // Where to send the browser after a successful OAuth callback.
  // Defaults to '/' (relative redirect keeps user on current host, whether ngrok or localhost)
  frontendOrigin: optional('FRONTEND_ORIGIN', '/'),

  sessionSecret: required('SESSION_SECRET'),

  // Optional explicit 32-byte key for encrypting GitHub tokens. If unset, one is
  // derived deterministically from SESSION_SECRET so there is a single secret to rotate.
  encryptionKey: optional('ENCRYPTION_KEY', ''),

  databaseUrl: required('DATABASE_URL'),
  geminiApiKey: optional('GEMINI_API_KEY', ''),
} as const;