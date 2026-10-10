import { validSession, sameOrigin } from '../server/auth.js';
import { getMembership, savePushSubscription, deletePushSubscriptionForUser } from '../server/db.js';
import { pushConfigured, vapidPublicKey } from '../server/push.js';
import { beginRequest, logFailure, observe } from '../server/observability.js';

const maxFieldLength = 2000;

export function createHandler(repository = {getMembership, savePushSubscription, deletePushSubscriptionForUser}, authenticate = validSession) {
  return async function handler(req, res) {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const session = authenticate(req);
    if (!session) { logFailure(request, '/api/push', 401); return res.status(401).json({error: 'Please sign in again.'}); }
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({error: 'Method not allowed.'});
    if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json({error: 'Request origin rejected.'});
    try {
      const membership = await repository.getMembership(session.userId);
      if (!membership) return res.status(403).json({error: 'Not a member of this household.'});

      if (req.method === 'GET') return res.status(200).json({configured: pushConfigured(), publicKey: vapidPublicKey()});

      if (req.method === 'POST') {
        const subscription = req.body?.subscription;
        const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint : '';
        const p256dh = typeof subscription?.keys?.p256dh === 'string' ? subscription.keys.p256dh : '';
        const auth = typeof subscription?.keys?.auth === 'string' ? subscription.keys.auth : '';
        if (!endpoint || !p256dh || !auth || endpoint.length > maxFieldLength) return res.status(400).json({error: 'Invalid push subscription.'});
        await repository.savePushSubscription({userId: session.userId, endpoint, p256dh, auth});
        return res.status(200).json({ok: true});
      }

      const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
      if (!endpoint) return res.status(400).json({error: 'Missing endpoint.'});
      await repository.deletePushSubscriptionForUser(session.userId, endpoint);
      return res.status(200).json({ok: true});
    } catch (error) {
      logFailure(request, '/api/push', 503, error); return res.status(503).json({error: 'Push notifications are unavailable.'});
    }
  };
}
export default observe('/api/push', createHandler());
