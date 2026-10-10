import { appOrigin, hashToken, randomToken, sameOrigin, validSession } from '../server/auth.js';
import { createInvitation, createPasswordReset, findUserById, getEmailDigestOptIn, getMembership, listMembers, listPendingInvitations, removeMember, revokeInvitation, setEmailDigestOptIn } from '../server/db.js';
import { emailConfigured, sendEmail } from '../server/email.js';
import { emailSchema, idSchema, roleSchema } from '../shared/schema.js';
import { beginRequest, logFailure, logIssue, observe } from '../server/observability.js';

const inviteLifetimeMs = 7 * 24 * 3600 * 1000;
const resetLifetimeMs = 3600 * 1000;

export function createHandler(repository = {getMembership, listMembers, listPendingInvitations, createInvitation, removeMember, revokeInvitation, createPasswordReset, findUserById, getEmailDigestOptIn, setEmailDigestOptIn}, authenticate = validSession) {
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
        const emailDigestOptIn = await repository.getEmailDigestOptIn(session.userId);
        return res.status(200).json({members, invitations, role: membership.role, emailConfigured: emailConfigured(), emailDigestOptIn});
      }
      const body = req.body || {};
      // Any member can set their own weekly-digest preference; everything else here is owner-only.
      if (body.type === 'set-email-digest') {
        const optIn = Boolean(body.optIn);
        await repository.setEmailDigestOptIn(session.userId, optIn);
        return res.status(200).json({ok: true, emailDigestOptIn: optIn});
      }
      if (membership.role !== 'owner') return res.status(403).json({error: 'Only owners can manage household members.'});
      if (body.type === 'invite') {
        const email = emailSchema.parse(body.email);
        const role = roleSchema.parse(body.role);
        const rawToken = randomToken();
        const expiresAt = new Date(Date.now() + inviteLifetimeMs).toISOString();
        await repository.createInvitation({email, role, invitedBy: session.userId, tokenHash: hashToken(rawToken), expiresAt});
        // The link is still returned below either way — email is a convenience on top of the
        // existing copy-the-link flow, never a replacement for it (see README's Architecture note).
        if (emailConfigured()) {
          try {
            await sendEmail({to: email, subject: 'You are invited to NorthStar Prep', text:
              `You've been invited to join a household on NorthStar Prep. Accept your invitation: ${appOrigin(req)}/?invite=${rawToken}\n\nThis link expires in 7 days.`});
          } catch (error) { logIssue(request, '/api/members', 'invite_email_failure', error); }
        }
        return res.status(200).json({token: rawToken, expiresAt});
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
        if (emailConfigured()) {
          try {
            const user = await repository.findUserById(userId);
            if (user?.email) {
              await sendEmail({to: user.email, subject: 'Your NorthStar Prep password reset link', text:
                `Reset your password: ${appOrigin(req)}/?reset=${rawToken}\n\nThis link expires in 1 hour and can only be used once.`});
            }
          } catch (error) { logIssue(request, '/api/members', 'reset_email_failure', error); }
        }
        return res.status(200).json({token: rawToken, expiresAt});
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
