import { acceptInvitation, findInvitationByTokenHash, findUserByEmail } from '../server/db.js';
import { cookie, hashPassword, hashToken, sameOrigin, token as sessionToken } from '../server/auth.js';
import { emailSchema, passwordSchema } from '../shared/schema.js';
import { beginRequest, logFailure, observe } from '../server/observability.js';

function invitationStillValid(invitation) {
  return Boolean(invitation) && !invitation.accepted_at && new Date(invitation.expires_at) > new Date();
}

export function createHandler(repository = {findInvitationByTokenHash, acceptInvitation, findUserByEmail}) {
  return async function handler(req, res) {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      const rawToken = new URL(req.url, 'http://localhost').searchParams.get('token');
      if (!rawToken) return res.status(400).json({error: 'Missing invitation token.'});
      try {
        const invitation = await repository.findInvitationByTokenHash(hashToken(rawToken));
        if (!invitationStillValid(invitation)) return res.status(404).json({valid: false});
        return res.status(200).json({valid: true, email: invitation.email, role: invitation.role});
      } catch (error) { logFailure(request, '/api/invite', 503, error); return res.status(503).json({error: 'Invitation lookup unavailable.'}); }
    }
    if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed.'});
    if (!sameOrigin(req)) return res.status(403).json({error: 'Request origin rejected.'});
    const rawToken = typeof req.body?.token === 'string' ? req.body.token : '';
    const emailResult = emailSchema.safeParse(req.body?.email);
    const passwordResult = passwordSchema.safeParse(req.body?.password);
    if (!rawToken || !emailResult.success || !passwordResult.success) return res.status(400).json({error: 'Enter a valid email and a password of at least 8 characters.'});
    try {
      const invitation = await repository.findInvitationByTokenHash(hashToken(rawToken));
      if (!invitationStillValid(invitation)) return res.status(410).json({error: 'This invitation is no longer valid. Ask the household owner for a new link.'});
      if (invitation.email !== emailResult.data) return res.status(400).json({error: 'Use the email address this invitation was sent to.'});
      const existing = await repository.findUserByEmail(emailResult.data);
      if (existing) return res.status(409).json({error: 'An account with this email already exists. Sign in instead.'});
      const userId = await repository.acceptInvitation({
        invitationId: invitation.id, householdId: invitation.household_id, role: invitation.role,
        email: emailResult.data, passwordHash: hashPassword(passwordResult.data),
      });
      res.setHeader('Set-Cookie', cookie(sessionToken(userId)));
      return res.status(200).json({authenticated: true, user: {id: userId, role: invitation.role}});
    } catch (error) {
      if (error?.code === '23505') return res.status(409).json({error: 'An account with this email already exists. Sign in instead.'});
      logFailure(request, '/api/invite', 503, error); return res.status(503).json({error: 'Accepting the invitation failed. Try again.'});
    }
  };
}
export default observe('/api/invite', createHandler());
