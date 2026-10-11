import go from './_go.js';
import alerts from './_alerts.js';
import push from './_push.js';

// One Vercel Function serving /api/go, /api/alerts and /api/push (see the rewrites in
// vercel.json). The Hobby plan allows at most 12 functions per deployment, and every non-underscore
// file under api/ is one; files starting with "_" are not deployed as functions, so the handlers
// live there and this file only dispatches. tests/function-count.test.js keeps the total in check.
const routes = {go, alerts, push};

export default function handler(req, res) {
  const route = req.query?.route ?? new URL(req.url || '/', 'http://localhost').searchParams.get('route');
  const target = Object.hasOwn(routes, route) ? routes[route] : null;
  if (!target) return res.status(404).json({error: 'Not found.'});
  return target(req, res);
}
