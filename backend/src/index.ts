import { config } from './config';
import { prisma } from './db';
import { createApp } from './app';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[repo-pulse] listening on :${config.port} (${config.isProd ? 'production' : 'development'})`);
});

async function shutdown(): Promise<void> {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());