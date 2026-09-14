// Disposable Postgres databases. Each suite creates its own database, migrates it, and drops
// it afterwards, so nothing depends on leftover state and two runs never collide.
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);
export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const registerPath = fileURLToPath(new URL('./register.js', import.meta.url));

// Matches the postgres:16 service GitHub Actions starts for this repository's workflow.
export function adminUrl() {
  return process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
}

export async function postgresAvailable() {
  const client = new pg.Client({connectionString: adminUrl(), connectionTimeoutMillis: 3000});
  try { await client.connect(); await client.end(); return true; }
  catch { return false; }
}

async function withAdmin(fn) {
  const client = new pg.Client({connectionString: adminUrl()});
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

function urlFor(name) {
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

export async function createDisposableDatabase(prefix = 'northstar_test') {
  const name = `${prefix}_${randomBytes(6).toString('hex')}`;
  await withAdmin(client => client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`));
  return {name, url: urlFor(name)};
}

export async function dropDatabase(name) {
  if (!name) return;
  await withAdmin(client => client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(name)} WITH (FORCE)`));
}

// Runs the real migration script in a child process, exactly as `npm run db:migrate` does,
// with the Neon driver pointed at the disposable database.
export async function migrate(databaseUrl, env = {}) {
  return run(process.execPath, ['--import', pathToFileURL(registerPath).href, 'scripts/migrate.js'], {
    cwd: repoRoot,
    env: {...process.env, DATABASE_URL: databaseUrl, DATABASE_URL_UNPOOLED: '', ...env},
  });
}
