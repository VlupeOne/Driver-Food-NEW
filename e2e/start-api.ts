import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../apps/api/src/app.js';

const runDirectory = mkdtempSync(join(tmpdir(), 'driver-food-e2e-'));
const databasePath = join(runDirectory, 'driver-food.sqlite');
const app = buildApp({ databasePath, seed: true, logger: true });

let isClosing = false;

async function close(): Promise<void> {
  if (isClosing) return;
  isClosing = true;

  try {
    app.server.closeAllConnections();
    await app.close();
  } finally {
    rmSync(runDirectory, { recursive: true, force: true });
  }
}

process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});

void app.listen({ host: '127.0.0.1', port: 43333 }).catch(async (error: unknown) => {
  await close();
  throw error;
});
