import { configured, cookie, hashPassword, loginKey, randomToken, sameOrigin, token, validSession, verifyPassword } from '../server/auth.js';
import { findUserByEmail, getMembership, rateLimit } from '../server/db.js';
import { emailSchema } from '../shared/schema.js';
import { beginRequest, logFailure, observe } from '../server/observability.js';

// Computed once so a login attempt against a non-existent email still runs a full
// scrypt verification, keeping response timing close to a real wrong-password attempt.
const dummyHash = hashPassword(randomToken());

export function createHandler(repository = {rateLimit, findUserByEmail, getMembership}) {
  return async function handler(req, res) {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      const session = validSession(req);
      if (!session) return res.status(200).json({authenticated: false, configured: configured()});
      try {
        const membership = await repository.getMembership(session.userId);
        if (!membership) return res.status(200).json({authenticated: false, configured: configured()});
        return res.status(200).json({authenticated: true, configured: configured(), user: {id: session.userId, role: membership.role}});
      } catch (error) { logFailure(request, '/api/session', 503, error); return res.status(503).json({error: 'Account lookup unavailable.'}); }
    }
    if (!['POST', 'DELETE'].includes(req.method)) return res.status(405).json({error: 'Method not allowed.'});
    if (!sameOrigin(req)) return res.status(403).json({error: 'Request origin rejected.'});
    if (req.method === 'DELETE') { res.setHeader('Set-Cookie', cookie('', true)); return res.status(200).json({ok: true}); }
    if (!configured()) return res.status(503).json({error: 'Login and database need configuration.'});
    const emailResult = emailSchema.safeParse(req.body?.email);
    if (!emailResult.success || typeof req.body?.password !== 'string' || req.body.password.length > 500) {
      return res.status(400).json({error: 'Enter a valid email and password.'});
    }
    try {
      if (!await repository.rateLimit(loginKey(req))) return res.status(429).json({error: 'Too many attempts. Try again in 15 minutes.'});
      const user = await repository.findUserByEmail(emailResult.data);
      const passwordOk = verifyPassword(req.body.password, user?.password_hash ?? dummyHash);
      if (!user || !passwordOk) return res.status(401).json({error: 'Incorrect email or password.'});
      const membership = await repository.getMembership(user.id);
      if (!membership) return res.status(403).json({error: 'This account is not a member of the household.'});
      res.setHeader('Set-Cookie', cookie(token(user.id)));
      return res.status(200).json({authenticated: true, user: {id: user.id, role: membership.role}});
    } catch (error) { logFailure(request, '/api/session', 503, error); return res.status(503).json({error: 'Login is unavailable. Check database setup.'}); }
  };
}
export default observe('/api/session', createHandler());
