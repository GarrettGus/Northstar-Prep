// One-off migration: uploads any base64 image data still stored in Postgres (from before
// object storage was added, or from importing an old JSON/legacy backup) to Vercel Blob and
// rewrites the row to store only the resulting URL. Safe to re-run; already-migrated rows
// (image already a storage URL, or empty) are left untouched.
import { neon } from '@neondatabase/serverless';
import { isDataUrlImage, storeImage } from '../server/imageStore.js';

const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
const householdId = 1;
const tables = ['northstar_inventory', 'northstar_shopping_items'];

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is not set. Connect a Vercel Blob store and set the token before running this migration.');
  process.exit(1);
}

let migrated = 0, failed = 0;
for (const table of tables) {
  const rows = await sql`SELECT id, image FROM ${sql.unsafe(table)} WHERE household_id = ${householdId} AND image LIKE 'data:image/%'`;
  for (const row of rows) {
    if (!isDataUrlImage(row.image)) { console.error(`Skipping ${table} ${row.id}: stored image is not a recognized data URL.`); failed++; continue; }
    try {
      const url = await storeImage(row.image, {householdId, itemId: row.id});
      await sql`UPDATE ${sql.unsafe(table)} SET image = ${url} WHERE household_id = ${householdId} AND id = ${row.id}`;
      migrated++;
    } catch (error) {
      console.error(`Failed to migrate ${table} ${row.id}: ${error.message}`);
      failed++;
    }
  }
}
console.log(`Image migration complete: ${migrated} migrated, ${failed} failed.`);
if (failed > 0) process.exit(1);
