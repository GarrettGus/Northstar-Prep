// Shared constants and the handoff file between global setup, the Playwright config,
// the specs and global teardown. Everything lives in one temporary directory so the
// suite leaves nothing behind in the repository.
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

export const port = Number(process.env.NORTHSTAR_E2E_PORT) || 5183;
export const baseURL = `http://127.0.0.1:${port}`;
export const stateDir = join(tmpdir(), 'northstar-e2e');
export const statePath = join(stateDir, 'environment.json');
export const storageStatePath = join(stateDir, 'owner-session.json');

export function environment() {
  return JSON.parse(readFileSync(statePath, 'utf8'));
}
