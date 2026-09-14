// Preload for child processes that must reach Postgres through the shipping Neon driver:
//   node --import ./tests/support/register.js scripts/migrate.js
// Used by the migration suite and by the browser suite's app server.
import { installNeonOverPostgres } from './neonOverPostgres.js';
installNeonOverPostgres();
