import { validSession, sameOrigin } from '../server/auth.js';
import { readState, compareAndSave } from '../server/db.js';
import { applyAction } from '../shared/schema.js';
import { beginRequest, logFailure } from '../server/observability.js';
export function createHandler(repository = {readState,compareAndSave}, authenticate = validSession) {
  return async (req,res) => {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control','no-store');
    if (!authenticate(req)) { logFailure(request, '/api/hub', 401); return res.status(401).json({error:'Please sign in again.'}); }
    if (!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Method not allowed.'});
    if (req.method === 'POST' && !sameOrigin(req)) return res.status(403).json({error:'Request origin rejected.'});
    try {
      if (req.method === 'GET') return res.status(200).json(await repository.readState());
      if (!req.body || typeof req.body !== 'object' || JSON.stringify(req.body).length > 3_000_000) return res.status(400).json({error:'Invalid or oversized request.'});
      for (let attempt=0; attempt<4; attempt++) {
        const current = await repository.readState();
        let next;
        try { next = applyAction(current.data,req.body); }
        catch { return res.status(400).json({error:'Invalid data or item conflict. Check fields and refresh before retrying.'}); }
        const version = await repository.compareAndSave(current.version,next);
        if (version !== undefined) return res.status(200).json({data:next,version});
      }
      return res.status(409).json({error:'Another device is updating the household. Please retry.'});
    } catch (error) { logFailure(request, '/api/hub', 503, error); return res.status(503).json({error:'Database unavailable. Your changes were not confirmed; refresh before retrying.'}); }
  };
}
export default createHandler();
