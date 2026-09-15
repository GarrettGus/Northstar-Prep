import { findCredentialsById, rateLimit, setPassword } from '../server/db.js';
import { hashPassword, loginKey, sameOrigin, validSession, verifyPassword } from '../server/auth.js';
import { passwordSchema } from '../shared/schema.js';
import { beginRequest, logFailure, observe } from '../server/observability.js';

// Self-service password change for a signed-in user who still knows their current password;
// the reset-link flow in api/password-reset.js covers a locked-out member instead.
export function createHandler(repository = {rateLimit, findCredentialsById, setPassword}, authenticate = validSession) {
  return async function handler(req, res) {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const session = authenticate(req);
    if (!session) { logFailure(request, '/api/password', 401); return res.status(401).json({error: 'Please sign in again.'}); }
    if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed.'});
    if (!sameOrigin(req)) return res.status(403).json({error: 'Request origin rejected.'});
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPasswordResult = passwordSchema.safeParse(req.body?.newPassword);
    if (!currentPassword || !newPasswordResult.success) return res.status(400).json({error: 'Enter your current password and a new password of at least 8 characters.'});
    try {
      // Rate-limited like login, since this also verifies a password guess against a stored hash.
      if (!await repository.rateLimit(loginKey(req))) return res.status(429).json({error: 'Too many attempts. Try again in 15 minutes.'});
      const user = await repository.findCredentialsById(session.userId);
      if (!user || !verifyPassword(currentPassword, user.password_hash)) return res.status(401).json({error: 'Current password is incorrect.'});
      await repository.setPassword(session.userId, hashPassword(newPasswordResult.data));
      return res.status(200).json({ok: true});
    } catch (error) {
      logFailure(request, '/api/password', 503, error); return res.status(503).json({error: 'Changing your password failed. Try again.'});
    }
  };
}
export default observe('/api/password', createHandler());
