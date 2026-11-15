import { audit, readinessHistory, reminderHistory } from './_history.js';

// One Vercel Function serving /api/audit, /api/readiness-history and /api/reminder-history (see
// the rewrites in vercel.json), for the same reason api/live.js exists: the Hobby plan allows
// at most 12 functions per deployment and every non-underscore file under api/ is one.
// tests/function-count.test.js keeps the total in check and the rewrites in step with this table.
const routes = {'audit': audit, 'readiness-history': readinessHistory, 'reminder-history': reminderHistory};

export default function handler(req, res) {
  const route = req.query?.route ?? new URL(req.url || '/', 'http://localhost').searchParams.get('route');
  const target = Object.hasOwn(routes, route) ? routes[route] : null;
  if (!target) return res.status(404).json({error: 'Not found.'});
  return target(req, res);
}
