import { database } from '../server/db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({status:'error', error:'Method not allowed.'});
  const started = Date.now();
  try {
    const sql = database();
    await sql`SELECT 1`;
    return res.status(200).json({status:'ok', database:'ok', latencyMs:Date.now()-started});
  } catch {
    return res.status(503).json({status:'error', database:'unavailable'});
  }
}
