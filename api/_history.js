import { getMembership, listAuditLog, listReadinessHistory, listReminderHistory } from '../server/db.js';
import { validSession } from '../server/auth.js';
import { beginRequest, logFailure, observe } from '../server/observability.js';

// The three read-only history lists (activity log, readiness snapshots, reminder checks) are the
// same endpoint with a different query, so they share one handler factory. api/history.js
// serves them as a single Vercel Function; each is still reachable at its own /api path through
// the rewrites in vercel.json.
function historyHandler({route, repositoryKey, unavailable}, defaults) {
  return function createHandler(repository = defaults, authenticate = validSession) {
    return async function handler(req, res) {
      const request = beginRequest(req, res);
      res.setHeader('Cache-Control', 'no-store');
      const session = authenticate(req);
      if (!session) { logFailure(request, route, 401); return res.status(401).json({error: 'Please sign in again.'}); }
      if (req.method !== 'GET') return res.status(405).json({error: 'Method not allowed.'});
      try {
        const membership = await repository.getMembership(session.userId, 1, session.version);
        if (!membership) return res.status(403).json({error: 'Not a member of this household.'});
        const entries = await repository[repositoryKey]();
        return res.status(200).json({entries});
      } catch (error) { logFailure(request, route, 503, error); return res.status(503).json({error: unavailable}); }
    };
  };
}

export const createAuditHandler = historyHandler(
  {route: '/api/audit', repositoryKey: 'listAuditLog', unavailable: 'Activity history is unavailable.'},
  {getMembership, listAuditLog});
export const createReadinessHistoryHandler = historyHandler(
  {route: '/api/readiness-history', repositoryKey: 'listReadinessHistory', unavailable: 'Readiness history is unavailable.'},
  {getMembership, listReadinessHistory});
export const createReminderHistoryHandler = historyHandler(
  {route: '/api/reminder-history', repositoryKey: 'listReminderHistory', unavailable: 'Reminder history is unavailable.'},
  {getMembership, listReminderHistory});

export const audit = observe('/api/audit', createAuditHandler());
export const readinessHistory = observe('/api/readiness-history', createReadinessHistoryHandler());
export const reminderHistory = observe('/api/reminder-history', createReminderHistoryHandler());
