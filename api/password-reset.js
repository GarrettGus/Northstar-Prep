import { createPasswordReset, findPasswordResetByTokenHash, findUserByEmail, getMembership, rateLimit, resetPassword } from '../server/db.js';
import { appUrl, emailConfigured, resetEmail, sendEmail } from '../server/email.js';
import { cookie, hashPassword, hashToken, loginKey, randomToken, sameOrigin, token as sessionToken } from '../server/auth.js';
import { emailSchema, passwordSchema } from '../shared/schema.js';
import { beginRequest, logFailure, logIssue, observe } from '../server/observability.js';

const resetLifetimeMs = 3600 * 1000;

function resetStillValid(reset) {
  return Boolean(reset) && !reset.used_at && new Date(reset.expires_at) > new Date();
}

// Consumes a single-use reset link an owner generated for a member (see the 'reset-link'
// action in api/members.js) — mirrors api/invite.js's shape, but sets a password on an
// existing account instead of creating one.
//
// With email configured, a signed-out member can also ask for a link themselves
// ({type: 'request', email}). That is what finally gives a locked-out sole owner a way back
// without database access. The reply is the same whether or not the account exists, so the
// endpoint cannot be used to discover who is a member.
export function createHandler(repository = {findPasswordResetByTokenHash, resetPassword, getMembership, rateLimit, findUserByEmail, createPasswordReset}, mailer = {configured: emailConfigured, send: sendEmail}) {
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
    if (req.body?.type === 'request') {
      if (!mailer.configured()) return res.status(503).json({error: 'Email is not set up for this household. Ask a household owner for a reset link.'});
      const emailResult = emailSchema.safeParse(req.body?.email);
      if (!emailResult.success) return res.status(400).json({error: 'Enter a valid email address.'});
      const email = emailResult.data;
      const sent = {ok: true, message: 'If that address belongs to a household member, a reset link is on its way. It expires in 1 hour.'};
      try {
        // Limited per IP (like sign-in) and per address, so nobody can flood someone's inbox.
        if (!await repository.rateLimit(loginKey(req)) || !await repository.rateLimit(`reset-request:${hashToken(email)}`)) return res.status(429).json({error: 'Too many attempts. Try again in 15 minutes.'});
        const user = await repository.findUserByEmail(email);
        if (!user || !await repository.getMembership(user.id)) return res.status(200).json(sent);
        const rawToken = randomToken();
        await repository.createPasswordReset({userId: user.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + resetLifetimeMs).toISOString()});
        try { await mailer.send({to: user.email, ...resetEmail({link: `${appUrl(req)}/?reset=${rawToken}`})}); }
        catch (error) { logIssue(request, '/api/password-reset', 'email_send_failure', error); }
        return res.status(200).json(sent);
      } catch (error) { logFailure(request, '/api/password-reset', 503, error); return res.status(503).json({error: 'Reset requests are unavailable. Try again.'}); }
    }
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
