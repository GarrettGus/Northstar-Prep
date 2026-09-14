// Routes @neondatabase/serverless's SQL-over-HTTP calls at a real local Postgres, so the
// migration and browser suites exercise the shipping server code (scripts/migrate.js,
// server/db.js, the /api handlers) unmodified against a disposable database.
//
// The driver only ever talks to its `fetchFunction`, so replacing that is enough: nothing in
// api/, server/ or scripts/ knows this exists, and nothing here is imported by the app.
// The protocol is small and stable (see the driver's README "Neon serverless driver"):
//   POST {query, params}            -> {fields, rows, rowCount, command}
//   POST {queries: [{query, params}]} -> {results: [ ...the above ]}
// Values travel as raw text (the driver always sends Neon-Raw-Text-Output/Neon-Array-Mode)
// and the driver parses them with pg-types, so this must NOT parse them first.
import { neonConfig } from '@neondatabase/serverless';
import pg from 'pg';

const rawText = {getTypeParser: () => value => value};
const isolationLevels = {
  ReadUncommitted: 'READ UNCOMMITTED', ReadCommitted: 'READ COMMITTED',
  RepeatableRead: 'REPEATABLE READ', Serializable: 'SERIALIZABLE',
};
// Mirrors the fields the driver copies off a 400 response onto NeonDbError.
const errorFields = ['severity', 'code', 'detail', 'hint', 'position', 'internalPosition', 'internalQuery', 'where', 'schema', 'table', 'column', 'dataType', 'constraint', 'file', 'line', 'routine'];

const pools = new Map();
let installed = false;

function poolFor(connectionString) {
  let pool = pools.get(connectionString);
  if (!pool) {
    // allowExitOnIdle keeps a one-shot script (the migration) from hanging on idle sockets.
    pool = new pg.Pool({connectionString, max: 8, allowExitOnIdle: true});
    pool.on('error', () => {});
    pools.set(connectionString, pool);
  }
  return pool;
}

async function runQuery(client, {query, params}) {
  const result = await client.query({text: query, values: params ?? [], rowMode: 'array', types: rawText});
  const {fields = [], rows = []} = Array.isArray(result) ? result[result.length - 1] : result;
  return {
    command: result.command ?? '', rowCount: result.rowCount ?? rows.length,
    fields: fields.map(field => ({name: field.name, dataTypeID: field.dataTypeID})),
    rows,
  };
}

async function runBatch(pool, queries, isolationLevel) {
  const client = await pool.connect();
  try {
    await client.query(isolationLevel ? `BEGIN ISOLATION LEVEL ${isolationLevels[isolationLevel] ?? 'READ COMMITTED'}` : 'BEGIN');
    const results = [];
    for (const query of queries) results.push(await runQuery(client, query));
    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
}

async function handle(_url, init) {
  const headers = init?.headers ?? {};
  const connectionString = headers['Neon-Connection-String'];
  if (!connectionString) return json({message: 'Missing Neon-Connection-String header.'}, 400);
  const body = JSON.parse(init.body);
  const pool = poolFor(connectionString);
  try {
    if (Array.isArray(body.queries)) return json({results: await runBatch(pool, body.queries, headers['Neon-Batch-Isolation-Level'])});
    const client = await pool.connect();
    try { return json(await runQuery(client, body)); }
    finally { client.release(); }
  } catch (error) {
    return json({message: error.message, ...Object.fromEntries(errorFields.map(field => [field, error[field]]))}, 400);
  }
}

export function installNeonOverPostgres() {
  if (installed) return;
  installed = true;
  neonConfig.fetchFunction = handle;
  // The driver still builds a URL from fetchEndpoint even though fetchFunction ignores it.
  neonConfig.fetchEndpoint = () => 'http://neon-over-postgres.test/sql';
}

export async function closeNeonPools() {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map(pool => pool.end().catch(() => {})));
}
