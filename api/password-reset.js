import { findPasswordResetByTokenHash, getMembership, rateLimit, resetPassword } from '../server/db.js';
import { cookie, hashPassword, hashToken, loginKey, sameOrigin, token as sessionToken } from '../server/auth.js';
import { passwordSchema } from '../shared/schema.js';
import { beginRequest, logFailure, observe } from '../server/observability.js';

function resetStillValid(reset) {
  return Boolean(reset) && !reset.used_at && new Date(reset.expires_at) > new Date();
}

// Consumes a single-use reset link an owner generated for a member (see the 'reset-link'
// action in api/members.js) — mirrors api/invite.js's shape, but sets a password on an
// existing account instead of creating one.
export function createHandler(repository = {findPasswordResetByTokenHash, resetPassword, getMembership, rateLimit}) {
  return async function handler(req, res) {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      const rawToken = new URL(req.url, 'http://localhost').searchParams.get('token');
      if (!rawToken) return res.status(400).json({error: 'Missing reset token.'});
      try {
        const reset = await repository.findPasswordResetByTokenHash(hashToken(rawToken));
        if (!resetStillValid(reset)) return res.status(404).json({valid: false});
        return res.status(200).json({valid: true, email: reset.email});
      } catch (error) { logFailure(request, '/api/password-reset', 503, error); return res.status(503).json({error: 'Reset link lookup unavailable.'}); }
    }
    if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed.'});
    if (!sameOrigin(req)) return res.status(403).json({error: 'Request origin rejected.'});
    const rawToken = typeof req.body?.token === 'string' ? req.body.token : '';
    const passwordResult = passwordSchema.safeParse(req.body?.password);
    if (!rawToken || !passwordResult.success) return res.status(400).json({error: 'Enter a password of at least 8 characters.'});
    try {
      // Rate-limited by IP, as login attempts already are, since a token is a guessable secret.
      if (!await repository.rateLimit(loginKey(req))) return res.status(429).json({error: 'Too many attempts. Try again in 15 minutes.'});
      const reset = await repository.findPasswordResetByTokenHash(hashToken(rawToken));
      if (!resetStillValid(reset)) return res.status(410).json({error: 'This reset link is no longer valid. Ask a household owner for a new one.'});
      const membership = await repository.getMembership(reset.user_id);
      if (!membership) return res.status(410).json({error: 'This account is no longer a household member.'});
      await repository.resetPassword({userId: reset.user_id, passwordHash: hashPassword(passwordResult.data)});
      res.setHeader('Set-Cookie', cookie(sessionToken(reset.user_id)));
      return res.status(200).json({authenticated: true, user: {id: reset.user_id, role: membership.role}});
    } catch (error) {
      logFailure(request, '/api/password-reset', 503, error); return res.status(503).json({error: 'Resetting the password failed. Try again.'});
    }
  };
}
export default observe('/api/password-reset', createHandler());
