import { hashToken, randomToken, sameOrigin, validSession } from '../server/auth.js';
import { createInvitation, createPasswordReset, findUserById, getMembership, listMembers, listPendingInvitations, removeMember, revokeInvitation } from '../server/db.js';
import { appUrl, emailConfigured, inviteEmail, resetEmail, sendEmail } from '../server/email.js';
import { emailSchema, idSchema, roleSchema } from '../shared/schema.js';
import { beginRequest, logFailure, logIssue, observe } from '../server/observability.js';

const inviteLifetimeMs = 7 * 24 * 3600 * 1000;
const resetLifetimeMs = 3600 * 1000;

// Sends the link by email when a provider is configured. Never throws: the token is already
// stored and returned to the owner, so a failed send only means they share the link by hand.
async function deliver(request, to, message, mailer) {
  if (!to || !mailer.configured()) return false;
  try { return (await mailer.send({to, ...message})).sent === true; }
  catch (error) { logIssue(request, '/api/members', 'email_send_failure', error); return false; }
}

export function createHandler(repository = {getMembership, listMembers, listPendingInvitations, createInvitation, removeMember, revokeInvitation, createPasswordReset, findUserById}, authenticate = validSession, mailer = {configured: emailConfigured, send: sendEmail}) {
  return async function handler(req, res) {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const session = authenticate(req);
    if (!session) { logFailure(request, '/api/members', 401); return res.status(401).json({error: 'Please sign in again.'}); }
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({error: 'Method not allowed.'});
    if (req.method === 'POST' && !sameOrigin(req)) return res.status(403).json({error: 'Request origin rejected.'});
    try {
      const membership = await repository.getMembership(session.userId);
      if (!membership) return res.status(403).json({error: 'Not a member of this household.'});
      if (req.method === 'GET') {
        const members = await repository.listMembers();
        const invitations = membership.role === 'owner' ? await repository.listPendingInvitations() : [];
        return res.status(200).json({members, invitations, role: membership.role, emailEnabled: mailer.configured()});
      }
      if (membership.role !== 'owner') return res.status(403).json({error: 'Only owners can manage household members.'});
      const body = req.body || {};
      if (body.type === 'invite') {
        const email = emailSchema.parse(body.email);
        const role = roleSchema.parse(body.role);
        const rawToken = randomToken();
        const expiresAt = new Date(Date.now() + inviteLifetimeMs).toISOString();
        await repository.createInvitation({email, role, invitedBy: session.userId, tokenHash: hashToken(rawToken), expiresAt});
        const base = appUrl(req);
        const emailed = base && body.sendEmail !== false ? await deliver(request, email, inviteEmail({link: `${base}/?invite=${rawToken}`, role, expiresAt}), mailer) : false;
        return res.status(200).json({token: rawToken, expiresAt, emailed});
      }
      if (body.type === 'remove') {
        const userId = idSchema.parse(body.userId);
        if (userId === session.userId) return res.status(400).json({error: 'You cannot remove yourself. Ask another owner.'});
        const removed = await repository.removeMember(userId);
        if (!removed) return res.status(400).json({error: 'Cannot remove the last owner, or that member no longer exists.'});
        return res.status(200).json({ok: true});
      }
      if (body.type === 'reset-link') {
        const userId = idSchema.parse(body.userId);
        const target = await repository.getMembership(userId);
        if (!target) return res.status(400).json({error: 'That member no longer exists.'});
        const rawToken = randomToken();
        const expiresAt = new Date(Date.now() + resetLifetimeMs).toISOString();
        await repository.createPasswordReset({userId, tokenHash: hashToken(rawToken), expiresAt});
        const base = appUrl(req);
        const user = base && body.sendEmail !== false && repository.findUserById ? await repository.findUserById(userId) : null;
        const emailed = user ? await deliver(request, user.email, resetEmail({link: `${base}/?reset=${rawToken}`}), mailer) : false;
        return res.status(200).json({token: rawToken, expiresAt, emailed});
      }
      if (body.type === 'revoke') {
        const invitationId = idSchema.parse(body.invitationId);
        const revoked = await repository.revokeInvitation(invitationId);
        if (!revoked) return res.status(400).json({error: 'Invitation not found or already accepted.'});
        return res.status(200).json({ok: true});
      }
      return res.status(400).json({error: 'Unknown request.'});
    } catch (error) {
      if (error?.name === 'ZodError') return res.status(400).json({error: 'Invalid request. Check the email, role and IDs.'});
      logFailure(request, '/api/members', 503, error); return res.status(503).json({error: 'Household management is unavailable.'});
    }
  };
}
export default observe('/api/members', createHandler());
