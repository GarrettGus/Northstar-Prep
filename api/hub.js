import { validSession, sameOrigin } from '../server/auth.js';
import { readState, compareAndSave, insertAuditLog } from '../server/db.js';
import { applyAction, collectionKey } from '../shared/schema.js';
import { beginRequest, logFailure } from '../server/observability.js';

function summarizeAction(action, previousState) {
  const nameOf = (key, id) => previousState?.[key]?.find(row => row.id === id)?.name ?? null;
  switch (action.type) {
    case 'add': case 'update':
      return {collection: action.collection, itemId: action.id, itemName: action.item?.name ?? nameOf(collectionKey[action.collection], action.id)};
    case 'delete':
      return {collection: action.collection, itemId: action.id, itemName: nameOf(collectionKey[action.collection], action.id)};
    case 'buy':
      return {collection: 'shopping_list', itemId: action.id, itemName: nameOf('shoppingList', action.id)};
    case 'bulk_delete':
      return {collection: action.collection, itemId: null, itemName: `${Array.isArray(action.ids) ? action.ids.length : 0} items`};
    case 'plan': return {collection: 'plan', itemId: null, itemName: null};
    case 'settings': return {collection: 'settings', itemId: null, itemName: null};
    default: return {collection: null, itemId: null, itemName: null};
  }
}

export function createHandler(repository = {readState, compareAndSave, logAudit: insertAuditLog}, authenticate = validSession) {
  return async (req,res) => {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control','no-store');
    const session = authenticate(req);
    if (!session) { logFailure(request, '/api/hub', 401); return res.status(401).json({error:'Please sign in again.'}); }
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
        const version = await repository.compareAndSave(current.version,next,current.data);
        if (version !== undefined) {
          try { await repository.logAudit({userId: session.userId, action: req.body.type, ...summarizeAction(req.body, current.data)}); }
          catch (error) { console.error(JSON.stringify({event:'audit_log_failure', requestId:request.id, error: error instanceof Error ? error.name : 'UnknownError'})); }
          return res.status(200).json({data:next,version});
        }
      }
      return res.status(409).json({error:'Another device is updating the household. Please retry.'});
    } catch (error) { logFailure(request, '/api/hub', 503, error); return res.status(503).json({error:'Database unavailable. Your changes were not confirmed; refresh before retrying.'}); }
  };
}
export default createHandler();
