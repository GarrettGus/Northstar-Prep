import { sameOrigin, validSession } from '../server/auth.js';
import { endActivation, getActivation, getMembership, insertAuditLog, listCheckins, listMembers, startActivation, upsertCheckin } from '../server/db.js';
import { activationModes, checkinStatuses } from '../shared/gotime.js';
import { beginRequest, logFailure, logIssue, observe } from '../server/observability.js';

// "Go time": activating the household plan and checking in during an event. Any member may
// activate or stand down -- in an emergency the person who notices first should not have to
// find an owner -- and every such change is written to the audit log. A member can only ever
// set their own check-in; the user ID comes from the session, never from the request body.
const note = value => typeof value === 'string' ? value.trim().slice(0, 280) : '';

export function createHandler(repository = {getMembership, getActivation, startActivation, endActivation, upsertCheckin, listCheckins, listMembers, logAudit: insertAuditLog}, authenticate = validSession) {
  return async function handler(req, res) {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const session = authenticate(req);
    if (!session) { logFailure(request, '/api/go', 401); return res.status(401).json({error: 'Please sign in again.'}); }
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({error: 'Method not allowed.'});
    if (req.method === 'POST' && !sameOrigin(req)) return res.status(403).json({error: 'Request origin rejected.'});
    try {
      const membership = await repository.getMembership(session.userId);
      if (!membership) return res.status(403).json({error: 'Not a member of this household.'});
      const body = req.body || {};
      if (req.method === 'POST') {
        let audit = null;
        if (body.type === 'activate') {
          if (!activationModes.includes(body.mode)) return res.status(400).json({error: 'Choose evacuate or shelter in place.'});
          await repository.startActivation({mode: body.mode, note: note(body.note), userId: session.userId});
          audit = {action: 'activate', itemName: body.mode};
        } else if (body.type === 'stand_down') {
          if (await repository.endActivation()) audit = {action: 'stand_down', itemName: null};
        } else if (body.type === 'checkin') {
          if (!checkinStatuses.includes(body.status)) return res.status(400).json({error: 'Unknown check-in status.'});
          await repository.upsertCheckin({userId: session.userId, status: body.status, note: note(body.note)});
          audit = {action: 'checkin', itemName: body.status};
        } else return res.status(400).json({error: 'Unknown request.'});
        if (audit) {
          try { await repository.logAudit({userId: session.userId, collection: 'plan_activation', itemId: null, ...audit}); }
          catch (error) { logIssue(request, '/api/go', 'audit_log_failure', error); }
        }
      }
      const [activation, checkins, members] = await Promise.all([repository.getActivation(), repository.listCheckins(), repository.listMembers()]);
      return res.status(200).json({
        activation,
        checkins: activation ? checkins : [],
        members: members.map(member => ({userId: member.user_id, email: member.email})),
        currentUserId: session.userId,
      });
    } catch (error) { logFailure(request, '/api/go', 503, error); return res.status(503).json({error: 'Plan activation is unavailable.'}); }
  };
}
export default observe('/api/go', createHandler());
