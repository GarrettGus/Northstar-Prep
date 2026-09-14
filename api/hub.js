import { validSession, sameOrigin } from '../server/auth.js';
import { readState, compareAndSave, insertAuditLog, householdId } from '../server/db.js';
import { applyAction, collectionKey, idSchema } from '../shared/schema.js';
import { beginRequest, logFailure, logIssue, observe } from '../server/observability.js';
import { storeImage, deleteImage, isDataUrlImage, isManagedImageUrl } from '../server/imageStore.js';

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
    case 'bulk_update':
      return {collection: action.collection, itemId: null, itemName: `${Array.isArray(action.ids) ? action.ids.length : 0} items`};
    case 'plan': return {collection: 'plan', itemId: null, itemName: null};
    case 'settings': return {collection: 'settings', itemId: null, itemName: null};
    default: return {collection: null, itemId: null, itemName: null};
  }
}

// Any base64 image data carried by an add/update/import action is uploaded to object storage
// here, before it ever reaches applyAction/Postgres; only the resulting URL is persisted.
function validItemId(id) {
  if (!idSchema.safeParse(id).success) throw new Error('Invalid item ID.');
  return id;
}
async function materializeRowImage(row, store) {
  if (!row || typeof row !== 'object' || !isDataUrlImage(row.image)) return row;
  return {...row, image: await store(row.image, {householdId, itemId: validItemId(row.id)})};
}
async function materializeActionImages(action, store) {
  if ((action.type === 'add' || action.type === 'update') && action.item && isDataUrlImage(action.item.image)) {
    return {...action, item: {...action.item, image: await store(action.item.image, {householdId, itemId: validItemId(action.id)})}};
  }
  if (action.type === 'import' && action.backup && typeof action.backup === 'object') {
    const backup = {...action.backup};
    for (const key of ['inventory', 'shoppingList']) {
      if (!Array.isArray(backup[key])) continue;
      backup[key] = await Promise.all(backup[key].map(row => materializeRowImage(row, store)));
    }
    return {...action, backup};
  }
  return action;
}

function managedImageUrls(state) {
  const urls = new Set();
  for (const row of [...state.inventory, ...state.shoppingList]) {
    if (isManagedImageUrl(row.image, householdId)) urls.add(row.image);
  }
  return urls;
}
// Best-effort: deletes any object-storage image that no longer appears in the saved state
// (item deleted, bulk-deleted, or its image replaced) so storage doesn't accumulate orphans.
async function cleanupOrphanedImages(previousState, nextState, remove) {
  const before = managedImageUrls(previousState);
  const after = managedImageUrls(nextState);
  const orphaned = [...before].filter(url => !after.has(url));
  await Promise.allSettled(orphaned.map(url => remove(url, householdId)));
}

export function createHandler(repository = {readState, compareAndSave, logAudit: insertAuditLog}, authenticate = validSession, imageStore = {store: storeImage, remove: deleteImage}) {
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
      let action;
      try { action = await materializeActionImages(req.body, imageStore.store); }
      catch (error) { return res.status(error.status || 400).json({error: error.message || 'Invalid image.'}); }
      for (let attempt=0; attempt<4; attempt++) {
        const current = await repository.readState();
        let next;
        try { next = applyAction(current.data,action); }
        catch { return res.status(400).json({error:'Invalid data or item conflict. Check fields and refresh before retrying.'}); }
        const version = await repository.compareAndSave(current.version,next,current.data);
        if (version !== undefined) {
          try { await repository.logAudit({userId: session.userId, action: action.type, ...summarizeAction(action, current.data)}); }
          catch (error) { logIssue(request, '/api/hub', 'audit_log_failure', error); }
          try { await cleanupOrphanedImages(current.data, next, imageStore.remove); }
          catch (error) { logIssue(request, '/api/hub', 'image_cleanup_failure', error); }
          return res.status(200).json({data:next,version});
        }
      }
      return res.status(409).json({error:'Another device is updating the household. Please retry.'});
    } catch (error) { logFailure(request, '/api/hub', 503, error); return res.status(503).json({error:'Database unavailable. Your changes were not confirmed; refresh before retrying.'}); }
  };
}
export default observe('/api/hub', createHandler());
