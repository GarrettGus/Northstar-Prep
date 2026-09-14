import { rm } from 'node:fs/promises';
import { dropDatabase } from '../../support/postgres.js';
import { environment, stateDir } from './support/environment.js';

export default async function globalTeardown() {
  let state;
  try { state = environment(); } catch { return; }
  if (state.serverPid) { try { process.kill(state.serverPid, 'SIGKILL'); } catch { /* already gone */ } }
  await dropDatabase(state.databaseName);
  await rm(stateDir, {recursive: true, force: true});
}
