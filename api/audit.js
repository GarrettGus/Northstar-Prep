import { getMembership, listAuditLog } from '../server/db.js';
import { validSession } from '../server/auth.js';
import { beginRequest, logFailure } from '../server/observability.js';

export function createHandler(repository = {getMembership, listAuditLog}, authenticate = validSession) {
  return async function handler(req, res) {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const session = authenticate(req);
    if (!session) { logFailure(request, '/api/audit', 401); return res.status(401).json({error: 'Please sign in again.'}); }
    if (req.method !== 'GET') return res.status(405).json({error: 'Method not allowed.'});
    try {
      const membership = await repository.getMembership(session.userId);
      if (!membership) return res.status(403).json({error: 'Not a member of this household.'});
      const entries = await repository.listAuditLog();
      return res.status(200).json({entries});
    } catch (error) { logFailure(request, '/api/audit', 503, error); return res.status(503).json({error: 'Activity history is unavailable.'}); }
  };
}
export default createHandler();
