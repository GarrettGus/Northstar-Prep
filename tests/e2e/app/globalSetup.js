// Brings up everything the full-app browser suite drives: a disposable Postgres database,
// the real migration, the real dev server (Vite + the /api handlers from api/), and a signed
// session cookie for the owner account. Nothing here is stubbed — the specs exercise the same
// code paths a deployment runs, with the Neon driver pointed at local Postgres.
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDisposableDatabase, dropDatabase, migrate, postgresAvailable, repoRoot } from '../../support/postgres.js';
import { baseURL, port, stateDir, statePath, storageStatePath } from './support/environment.js';

const registerPath = fileURLToPath(new URL('../../support/register.js', import.meta.url));

const owner = {email: 'owner@example.test', password: 'northstar-e2e-owner-password'};
const secrets = {
  SESSION_SECRET: randomBytes(32).toString('hex'),
  BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  CRON_SECRET: randomBytes(16).toString('hex'),
};

async function waitForServer(signal) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (signal.exited) throw new Error(`The app server exited before it was ready:\n${signal.output}`);
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) return;
    } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`The app server did not become ready on ${baseURL}:\n${signal.output}`);
}

export default async function globalSetup() {
  if (!await postgresAvailable()) {
    throw new Error('The full-app browser suite needs Postgres. Start one and set TEST_DATABASE_URL, or run `npm run test:e2e` for the database-free accessibility suite.');
  }

  const database = await createDisposableDatabase('northstar_e2e');
  await migrate(database.url, {...secrets, HOUSEHOLD_OWNER_EMAIL: owner.email, HOUSEHOLD_PASSWORD: owner.password});

  const server = spawn(process.execPath, ['--import', pathToFileURL(registerPath).href, 'scripts/dev.js'], {
    cwd: repoRoot,
    env: {...process.env, ...secrets, DATABASE_URL: database.url, PORT: String(port), NODE_ENV: 'development'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const signal = {exited: false, output: ''};
  const collect = chunk => { signal.output = (signal.output + chunk).slice(-4000); };
  server.stdout.on('data', collect);
  server.stderr.on('data', collect);
  server.on('exit', () => { signal.exited = true; });

  try {
    await waitForServer(signal);
  } catch (error) {
    server.kill('SIGKILL');
    await dropDatabase(database.name);
    throw error;
  }

  // Signing the cookie directly keeps every spec except login.spec.js off /api/session, which
  // is rate-limited to 10 attempts per IP per 15 minutes — a limit a browser suite would trip.
  process.env.SESSION_SECRET = secrets.SESSION_SECRET;
  const { token } = await import('../../../server/auth.js');
  const [{id: userId}] = await (async () => {
    const { default: pg } = await import('pg');
    const client = new pg.Client({connectionString: database.url});
    await client.connect();
    try { return (await client.query('SELECT id FROM northstar_users WHERE email = $1', [owner.email])).rows; }
    finally { await client.end(); }
  })();

  await rm(stateDir, {recursive: true, force: true});
  await mkdir(stateDir, {recursive: true});
  await writeFile(statePath, JSON.stringify({
    databaseName: database.name, databaseUrl: database.url, serverPid: server.pid,
    owner, cronSecret: secrets.CRON_SECRET, userId,
  }, null, 2));
  await writeFile(storageStatePath, JSON.stringify({
    cookies: [{
      name: 'northstar', value: token(userId), domain: '127.0.0.1', path: '/',
      expires: Math.floor(Date.now() / 1000) + 7 * 24 * 3600, httpOnly: true, secure: false, sameSite: 'Strict',
    }],
    origins: [],
  }, null, 2));

  server.unref();
}
