import { database } from '../server/db.js';
import { beginRequest, logFailure } from '../server/observability.js';

export default async function handler(req, res) {
  const request = beginRequest(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({status:'error', error:'Method not allowed.'});
  const started = Date.now();
  try {
    const sql = database();
    await sql`SELECT 1`;
    return res.status(200).json({status:'ok', database:'ok', latencyMs:Date.now()-started, requestId:request.id});
  } catch (error) {
    logFailure(request, '/api/health', 503, error);
    return res.status(503).json({status:'error', database:'unavailable'});
  }
}
