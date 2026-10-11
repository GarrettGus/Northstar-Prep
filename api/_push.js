import { sameOrigin, validSession } from '../server/auth.js';
import { deletePushSubscription, getMembership, listPushSubscriptions, savePushSubscription } from '../server/db.js';
import { broadcast, pushConfigured, subscriptionId, vapidPublicKey } from '../server/push.js';
import { beginRequest, logFailure, logIssue, observe } from '../server/observability.js';

// Turning push notifications on and off for this browser. A member only ever manages their own
// subscriptions; the user ID comes from the session, never from the request.
const base64url = /^[A-Za-z0-9_-]+={0,2}$/;
function parseSubscription(value) {
  const endpoint = value?.endpoint, p256dh = value?.keys?.p256dh, auth = value?.keys?.auth;
  if (typeof endpoint !== 'string' || endpoint.length > 1000 || !/^https:\/\/[^\s]+$/.test(endpoint)) return null;
  if (typeof p256dh !== 'string' || p256dh.length > 200 || !base64url.test(p256dh)) return null;
  if (typeof auth !== 'string' || auth.length > 100 || !base64url.test(auth)) return null;
  return {endpoint, p256dh, auth};
}

export function createHandler(repository = {getMembership, savePushSubscription, deletePushSubscription, listPushSubscriptions}, authenticate = validSession, push = {configured: pushConfigured, publicKey: vapidPublicKey, broadcast}) {
  return async function handler(req, res) {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const session = authenticate(req);
    if (!session) { logFailure(request, '/api/push', 401); return res.status(401).json({error: 'Please sign in again.'}); }
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({error: 'Method not allowed.'});
    if (req.method === 'POST' && !sameOrigin(req)) return res.status(403).json({error: 'Request origin rejected.'});
    try {
      if (!await repository.getMembership(session.userId)) return res.status(403).json({error: 'Not a member of this household.'});
      if (req.method === 'GET') return res.status(200).json({configured: push.configured(), publicKey: push.publicKey()});
      const body = req.body || {};
      if (body.type === 'unsubscribe') {
        if (typeof body.endpoint === 'string') await repository.deletePushSubscription(subscriptionId(body.endpoint), session.userId);
        return res.status(200).json({ok: true});
      }
      if (!push.configured()) return res.status(503).json({error: 'Push notifications are not set up for this household.'});
      if (body.type === 'subscribe') {
        const subscription = parseSubscription(body.subscription);
        if (!subscription) return res.status(400).json({error: 'Invalid push subscription.'});
        await repository.savePushSubscription({id: subscriptionId(subscription.endpoint), userId: session.userId, ...subscription});
        return res.status(200).json({ok: true});
      }
      if (body.type === 'test') {
        const subscriptions = await repository.listPushSubscriptions(1, {userId: session.userId});
        const result = await push.broadcast(subscriptions, {title: 'NorthStar Prep', body: 'Notifications are working on this device.', tag: 'test', url: '/'}, {
          remove: id => repository.deletePushSubscription(id), onError: error => logIssue(request, '/api/push', 'push_send_failure', error),
        });
        return res.status(200).json(result);
      }
      return res.status(400).json({error: 'Unknown request.'});
    } catch (error) { logFailure(request, '/api/push', 503, error); return res.status(503).json({error: 'Notifications are unavailable.'}); }
  };
}
export default observe('/api/push', createHandler());
