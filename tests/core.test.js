import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, emptyState, normalizeBackup, stateSchema, settingsSchema, emailSchema, passwordSchema, roleSchema, itemSchema, reminderSchema, planSchema } from '../shared/schema.js';
import { nextReminderDueDate, effectiveReminderDueDate, isReminderOverdue, addDaysISO } from '../shared/reminders.js';
import { checklistCatalog } from '../shared/checklists.js';
import { token, validSession, hashPassword, verifyPassword, hashToken, randomToken, cookie, sameOrigin } from '../server/auth.js';
import { createHandler } from '../api/hub.js';
import { createHandler as createSessionHandler } from '../api/session.js';
import { createHandler as createMembersHandler } from '../api/members.js';
import { createHandler as createInviteHandler } from '../api/invite.js';
import { createHandler as createReminderHistoryHandler } from '../api/reminder-history.js';
process.env.SESSION_SECRET='test-only-secret-with-more-than-32-characters';
process.env.DATABASE_URL='postgres://test-only/db';
const item={id:'rice',name:'Rice',quantity:2,category:'Food'};
test('legacy backups get IDs, restore plans and reject invalid data',()=>{
  const backup=normalizeBackup({inventory:[{name:'Rice'}],plan:{shelterSpot:'Basement'}},()=> 'generated');
  assert.equal(backup.inventory[0].id,'generated');
  assert.equal(backup.plan.shelterSpot,'Basement');
  assert.throws(()=>normalizeBackup({inventory:[{name:'Rice',quantity:-1}]},()=> 'id'));
  assert.throws(()=>normalizeBackup({appliances:[{name:'Fan',hours:25}]},()=> 'id'));
  assert.throws(()=>normalizeBackup({inventory:[{name:'Rice',expiryDate:'2026-02-30'}]},()=> 'id'));
  assert.throws(()=>normalizeBackup({plan:{family:'broken'}},()=> 'id'));
});
test('backup merge is repeatable and preserves existing records',()=>{
  const state=applyAction(emptyState(),{type:'add',collection:'inventory',id:'water',item:{name:'Water'}});
  const backup=normalizeBackup({inventory:[item],plan:{shelterSpot:'Basement'}},()=> 'id');
  const once=applyAction(state,{type:'import',backup});
  assert.deepEqual(applyAction(once,{type:'import',backup}),once);
  assert.equal(once.inventory.length,2);
  assert.equal(once.plan.shelterSpot,'Basement');
});
test('settings are validated, persisted and used by imports',()=>{
  const updated=applyAction(emptyState(),{type:'settings',settings:{householdSize:'6',survivalGoalDays:'30'}});
  assert.equal(updated.settings.householdSize,6);
  assert.equal(updated.settings.survivalGoalDays,30);
  const imported=normalizeBackup({settings:{householdSize:2},inventory:[]},()=> 'id');
  const merged=applyAction(updated,{type:'import',backup:imported});
  assert.equal(merged.settings.householdSize,2);
  assert.equal(merged.settings.survivalGoalDays,30);
  assert.throws(()=>applyAction(emptyState(),{type:'settings',settings:{householdSize:0}}));
});
test('item schema validates barcode and recurringDays, defaulting both when absent',()=>{
  const base={id:'x',name:'Rice'};
  assert.equal(itemSchema.parse(base).barcode,'');
  assert.equal(itemSchema.parse(base).recurringDays,0);
  assert.equal(itemSchema.parse({...base,barcode:' 012345678905 '}).barcode,'012345678905');
  assert.equal(itemSchema.parse({...base,recurringDays:'30'}).recurringDays,30);
  assert.throws(()=>itemSchema.parse({...base,barcode:'not valid!'}));
  assert.throws(()=>itemSchema.parse({...base,recurringDays:-1}));
});
test('bulk delete removes only validated IDs from one collection',()=>{
  let state=emptyState();
  state=applyAction(state,{type:'add',collection:'inventory',id:'a',item:{name:'A'}});
  state=applyAction(state,{type:'add',collection:'inventory',id:'b',item:{name:'B'}});
  state.shoppingList.push({...item,id:'shop'});
  const next=applyAction(state,{type:'bulk_delete',collection:'inventory',ids:['a']});
  assert.deepEqual(next.inventory.map(row=>row.id),['b']);
  assert.equal(next.shoppingList.length,1);
  assert.throws(()=>applyAction(state,{type:'bulk_delete',collection:'inventory',ids:['bad.id']}));
});
test('bulk update can set category and set/adjust quantity for only the selected items',()=>{
  let state=emptyState();
  state=applyAction(state,{type:'add',collection:'inventory',id:'a',item:{name:'A',category:'Food',quantity:5}});
  state=applyAction(state,{type:'add',collection:'inventory',id:'b',item:{name:'B',category:'Food',quantity:5}});
  const categorized=applyAction(state,{type:'bulk_update',collection:'inventory',ids:['a'],category:'Gear'});
  assert.equal(categorized.inventory.find(r=>r.id==='a').category,'Gear');
  assert.equal(categorized.inventory.find(r=>r.id==='b').category,'Food');

  const set=applyAction(state,{type:'bulk_update',collection:'inventory',ids:['a','b'],quantity:{mode:'set',value:9}});
  assert.equal(set.inventory.find(r=>r.id==='a').quantity,9);
  assert.equal(set.inventory.find(r=>r.id==='b').quantity,9);

  const adjusted=applyAction(state,{type:'bulk_update',collection:'inventory',ids:['a'],quantity:{mode:'delta',value:-3}});
  assert.equal(adjusted.inventory.find(r=>r.id==='a').quantity,2);
  const floored=applyAction(state,{type:'bulk_update',collection:'inventory',ids:['a'],quantity:{mode:'delta',value:-100}});
  assert.equal(floored.inventory.find(r=>r.id==='a').quantity,0);

  assert.throws(()=>applyAction(state,{type:'bulk_update',collection:'inventory',ids:['a']}));
  assert.throws(()=>applyAction(state,{type:'bulk_update',collection:'appliances',ids:['a'],category:'Gear'}));
  assert.throws(()=>applyAction(state,{type:'bulk_update',collection:'inventory',ids:['a'],category:'NotACategory'}));
});
test('buy is atomic and idempotent; ID collisions never overwrite stock',()=>{
  const state=applyAction(emptyState(),{type:'add',collection:'shopping_list',id:item.id,item});
  const bought=applyAction(state,{type:'buy',id:item.id});
  assert.equal(bought.shoppingList.length,0);assert.equal(bought.inventory.length,1);
  assert.deepEqual(applyAction(bought,{type:'buy',id:item.id}),bought);
  state.inventory=bought.inventory;
  assert.throws(()=>applyAction(state,{type:'buy',id:item.id}));
});
test('settings action validates and applies configurable readiness assumptions',()=>{
  const state=applyAction(emptyState(),{type:'settings',settings:{householdSize:6,caloriesPerPersonPerDay:2200}});
  assert.equal(state.settings.householdSize,6);
  assert.equal(state.settings.caloriesPerPersonPerDay,2200);
  assert.equal(state.settings.waterGallonsPerPersonPerDay,1);
  assert.throws(()=>applyAction(state,{type:'settings',settings:{householdSize:0}}));
  assert.throws(()=>applyAction(state,{type:'settings',settings:{batteryUsableFraction:1.5}}));
});
test('legacy state without stored settings gets defaulted values, and backup import leaves settings untouched',()=>{
  const legacy=stateSchema.parse({inventory:[],shoppingList:[],appliances:[],reminders:[],checklistChecks:[],plan:null});
  assert.deepEqual(legacy.settings,settingsSchema.parse({}));
  const configured=applyAction(emptyState(),{type:'settings',settings:{householdSize:2}});
  const backup=normalizeBackup({inventory:[item]},()=>'id');
  const imported=applyAction(configured,{type:'import',backup});
  assert.equal(imported.settings.householdSize,2);
});
test('email, password and role schemas validate and normalize input',()=>{
  assert.equal(emailSchema.parse('  Foo@Example.com '),'foo@example.com');
  assert.throws(()=>emailSchema.parse('not-an-email'));
  assert.equal(passwordSchema.parse('longenoughpw'),'longenoughpw');
  assert.throws(()=>passwordSchema.parse('short'));
  assert.equal(roleSchema.parse('owner'),'owner');
  assert.throws(()=>roleSchema.parse('admin'));
});
test('password hashing verifies correct passwords and rejects wrong ones or malformed hashes',()=>{
  const hash=hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple',hash),true);
  assert.equal(verifyPassword('wrong password',hash),false);
  assert.equal(verifyPassword('anything','not-a-real-hash'),false);
});
test('invitation tokens are opaque, single-use secrets that hash deterministically',()=>{
  const t=randomToken();
  assert.ok(t.length>20);
  assert.equal(hashToken(t),hashToken(t));
  assert.notEqual(hashToken(t),hashToken(randomToken()));
});
test('sessions carry the signed-in user, reject tampering/expiry, and rotating SESSION_SECRET invalidates them',()=>{
  const now=Date.now();const value=token('user-1',now);
  const req={headers:{cookie:cookie(value)}};
  assert.deepEqual(validSession(req,now),{userId:'user-1'});
  assert.equal(validSession(req,now+8*86400000),false);
  assert.equal(validSession({headers:{cookie:cookie(value+'x')}},now),false);
  const previousSecret=process.env.SESSION_SECRET;
  process.env.SESSION_SECRET='a-different-secret-that-is-also-long-enough';
  assert.equal(validSession(req,now),false);
  process.env.SESSION_SECRET=previousSecret;
});
test('mutations reject cross-site origins and non-JSON forms',()=>{
  assert.equal(sameOrigin({headers:{host:'example.com',origin:'https://evil.com','content-type':'application/json'}}),false);
  assert.equal(sameOrigin({headers:{host:'example.com',origin:'https://example.com','content-type':'text/plain'}}),false);
});
function response(){return {code:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};}
test('API refuses unauthenticated reads',async()=>{
  let called=false;const handler=createHandler({readState(){called=true;}},()=>false);const res=response();
  await handler({method:'GET',headers:{}},res);assert.equal(res.code,401);assert.equal(called,false);
  assert.match(res.headers['x-request-id'],/^[0-9a-f-]{36}$/);
});
test('API reapplies a mutation after a concurrent write without losing either item, and records who made it',async()=>{
  let state=emptyState(),version=0,conflict=true;
  const auditEntries=[];
  const repository={
    async readState(){return {data:structuredClone(state),version};},
    async compareAndSave(expected,next){
      if(conflict){conflict=false;state=applyAction(state,{type:'add',collection:'inventory',id:'other',item:{name:'Other device item'}});version++;return undefined;}
      assert.equal(expected,version);state=next;return ++version;
    },
    async logAudit(entry){auditEntries.push(entry);},
  };
  const handler=createHandler(repository,()=>({userId:'user-1'})),res=response();
  await handler({method:'POST',headers:{'content-type':'application/json'},body:{type:'add',collection:'inventory',id:'mine',item:{name:'My item'}}},res);
  assert.equal(res.code,200);assert.deepEqual(state.inventory.map(i=>i.id),['other','mine']);
  assert.deepEqual(auditEntries,[{userId:'user-1',action:'add',collection:'inventory',itemId:'mine',itemName:'My item'}]);
});
test('add/update actions upload base64 images to object storage before saving; deleting or replacing an image cleans up the orphaned object',async()=>{
  let state=emptyState(),version=0;
  const stored=[],removed=[];
  const repository={
    async readState(){return {data:structuredClone(state),version};},
    async compareAndSave(expected,next){if(expected!==version)return undefined;state=next;return ++version;},
    async logAudit(){},
  };
  const imageStore={
    async store(dataUrl,{householdId,itemId}){const url=`https://test.public.blob.vercel-storage.com/households/${householdId}/inventory/${itemId}/${stored.length}.png`;stored.push({dataUrl,url});return url;},
    async remove(url){removed.push(url);},
  };
  const handler=createHandler(repository,()=>({userId:'user-1'}),imageStore),addRes=response();
  await handler({method:'POST',headers:{'content-type':'application/json'},body:{type:'add',collection:'inventory',id:'lamp',item:{name:'Lamp',image:'data:image/png;base64,AAAA'}}},addRes);
  assert.equal(addRes.code,200);assert.equal(state.inventory[0].image,stored[0].url);assert.equal(stored.length,1);

  const updateRes=response();
  await handler({method:'POST',headers:{'content-type':'application/json'},body:{type:'update',collection:'inventory',id:'lamp',item:{image:'data:image/png;base64,BBBB'}}},updateRes);
  assert.equal(updateRes.code,200);assert.equal(state.inventory[0].image,stored[1].url);assert.deepEqual(removed,[stored[0].url]);

  const deleteRes=response();
  await handler({method:'POST',headers:{'content-type':'application/json'},body:{type:'delete',collection:'inventory',id:'lamp'}},deleteRes);
  assert.equal(deleteRes.code,200);assert.deepEqual(removed,[stored[0].url,stored[1].url]);
});
test('image storage failures surface as 503 when unconfigured or 400 when invalid, without saving',async()=>{
  let saved=false;
  const repository={async readState(){return {data:emptyState(),version:0};},async compareAndSave(){saved=true;return 1;},async logAudit(){}};
  const unconfigured=createHandler(repository,()=>({userId:'user-1'}),{async store(){const error=new Error('Object storage is not configured.');error.status=503;throw error;},async remove(){}});
  const res1=response();
  await unconfigured({method:'POST',headers:{'content-type':'application/json'},body:{type:'add',collection:'inventory',id:'x',item:{name:'X',image:'data:image/png;base64,AAAA'}}},res1);
  assert.equal(res1.code,503);assert.equal(saved,false);

  const invalid=createHandler(repository,()=>({userId:'user-1'}),{async store(){throw new Error('Image data does not match its declared file type.');},async remove(){}});
  const res2=response();
  await invalid({method:'POST',headers:{'content-type':'application/json'},body:{type:'add',collection:'inventory',id:'x',item:{name:'X',image:'data:image/png;base64,AAAA'}}},res2);
  assert.equal(res2.code,400);assert.equal(saved,false);
});
test('session login verifies passwords, checks membership and rate-limits attempts',async()=>{
  const hash=hashPassword('super-secret-pw');
  const repository={
    async rateLimit(){return true;},
    async findUserByEmail(email){return email==='owner@example.com' ? {id:'user-1',email,password_hash:hash} : undefined;},
    async getMembership(userId){return userId==='user-1' ? {role:'owner'} : undefined;},
  };
  const success=response();
  await createSessionHandler(repository)({method:'POST',headers:{'content-type':'application/json'},body:{email:'owner@example.com',password:'super-secret-pw'}},success);
  assert.equal(success.code,200);assert.equal(success.data.user.role,'owner');assert.match(success.headers['Set-Cookie'],/northstar=/);

  const wrong=response();
  await createSessionHandler(repository)({method:'POST',headers:{'content-type':'application/json'},body:{email:'owner@example.com',password:'nope'}},wrong);
  assert.equal(wrong.code,401);

  const unknown=response();
  await createSessionHandler(repository)({method:'POST',headers:{'content-type':'application/json'},body:{email:'nobody@example.com',password:'whatever1'}},unknown);
  assert.equal(unknown.code,401);

  const noMembership=response();
  await createSessionHandler({...repository,async getMembership(){return undefined;}})({method:'POST',headers:{'content-type':'application/json'},body:{email:'owner@example.com',password:'super-secret-pw'}},noMembership);
  assert.equal(noMembership.code,403);

  const limited=response();
  await createSessionHandler({...repository,async rateLimit(){return false;}})({method:'POST',headers:{'content-type':'application/json'},body:{email:'owner@example.com',password:'super-secret-pw'}},limited);
  assert.equal(limited.code,429);
});
test('GET session reports the authenticated profile or logged-out state',async()=>{
  const repository={async getMembership(userId){return userId==='user-1' ? {role:'member'} : undefined;}};
  const handler=createSessionHandler(repository);
  const authed=response();
  await handler({method:'GET',headers:{cookie:cookie(token('user-1'))}},authed);
  assert.deepEqual(authed.data,{authenticated:true,configured:true,user:{id:'user-1',role:'member'}});
  const loggedOut=response();
  await handler({method:'GET',headers:{}},loggedOut);
  assert.equal(loggedOut.data.authenticated,false);
});
test('members API: owners can invite, list and revoke; members cannot manage membership; self-removal is blocked',async()=>{
  const invitations=[];
  const repository={
    async getMembership(userId){return {'owner-1':{role:'owner'},'member-1':{role:'member'}}[userId];},
    async listMembers(){return [{user_id:'owner-1',email:'owner@example.com',role:'owner',added_at:'now'}];},
    async listPendingInvitations(){return invitations;},
    async createInvitation(entry){invitations.push({id:'inv-1',email:entry.email,role:entry.role,created_at:'now',expires_at:entry.expiresAt});},
    async revokeInvitation(id){const before=invitations.length;const kept=invitations.filter(i=>i.id!==id);invitations.length=0;invitations.push(...kept);return kept.length<before;},
  };
  const asOwner=createMembersHandler(repository,()=>({userId:'owner-1'}));
  const asMember=createMembersHandler(repository,()=>({userId:'member-1'}));

  const list=response();
  await asOwner({method:'GET',headers:{}},list);
  assert.equal(list.data.role,'owner');

  const invited=response();
  await asOwner({method:'POST',headers:{'content-type':'application/json'},body:{type:'invite',email:'new@example.com',role:'member'}},invited);
  assert.equal(invited.code,200);assert.equal(invitations.length,1);

  const denied=response();
  await asMember({method:'POST',headers:{'content-type':'application/json'},body:{type:'invite',email:'x@example.com',role:'member'}},denied);
  assert.equal(denied.code,403);

  const selfRemove=response();
  await asOwner({method:'POST',headers:{'content-type':'application/json'},body:{type:'remove',userId:'owner-1'}},selfRemove);
  assert.equal(selfRemove.code,400);

  const revoked=response();
  await asOwner({method:'POST',headers:{'content-type':'application/json'},body:{type:'revoke',invitationId:'inv-1'}},revoked);
  assert.equal(revoked.code,200);assert.equal(invitations.length,0);
});
test('members API surfaces a 400 when the repository blocks a removal, e.g. the last owner',async()=>{
  const repository={
    async getMembership(userId){return userId==='owner-1' ? {role:'owner'} : undefined;},
    async removeMember(){return false;},
  };
  const res=response();
  await createMembersHandler(repository,()=>({userId:'owner-1'}))({method:'POST',headers:{'content-type':'application/json'},body:{type:'remove',userId:'member-2'}},res);
  assert.equal(res.code,400);
});
test('invite API validates tokens, enforces the invited email, and rejects accounts that already exist',async()=>{
  const future=new Date(Date.now()+86400000).toISOString();
  const past=new Date(Date.now()-86400000).toISOString();
  const repository={
    async findInvitationByTokenHash(hash){
      if(hash===hashToken('good-token')) return {id:'inv-1',household_id:1,email:'invitee@example.com',role:'member',expires_at:future,accepted_at:null};
      if(hash===hashToken('expired-token')) return {id:'inv-2',household_id:1,email:'invitee@example.com',role:'member',expires_at:past,accepted_at:null};
      if(hash===hashToken('taken-token')) return {id:'inv-3',household_id:1,email:'taken@example.com',role:'member',expires_at:future,accepted_at:null};
      return undefined;
    },
    async findUserByEmail(email){return email==='taken@example.com' ? {id:'existing'} : undefined;},
    async acceptInvitation(){return 'new-user-id';},
  };
  const handler=createInviteHandler(repository);

  const validCheck=response();
  await handler({method:'GET',url:'/api/invite?token=good-token',headers:{}},validCheck);
  assert.deepEqual(validCheck.data,{valid:true,email:'invitee@example.com',role:'member'});

  const invalidCheck=response();
  await handler({method:'GET',url:'/api/invite?token=nope',headers:{}},invalidCheck);
  assert.equal(invalidCheck.data.valid,false);

  const expiredCheck=response();
  await handler({method:'GET',url:'/api/invite?token=expired-token',headers:{}},expiredCheck);
  assert.equal(expiredCheck.data.valid,false);

  const wrongEmail=response();
  await handler({method:'POST',headers:{'content-type':'application/json'},body:{token:'good-token',email:'someoneelse@example.com',password:'longenoughpw'}},wrongEmail);
  assert.equal(wrongEmail.code,400);

  const alreadyExists=response();
  await handler({method:'POST',headers:{'content-type':'application/json'},body:{token:'taken-token',email:'taken@example.com',password:'longenoughpw'}},alreadyExists);
  assert.equal(alreadyExists.code,409);

  const success=response();
  await handler({method:'POST',headers:{'content-type':'application/json'},body:{token:'good-token',email:'invitee@example.com',password:'longenoughpw'}},success);
  assert.equal(success.code,200);assert.equal(success.data.user.id,'new-user-id');assert.match(success.headers['Set-Cookie'],/northstar=/);
});
import { waterGallons, isExpired, computeReadiness, computeReadinessGaps, isRecurringDue, nextRecurringDate, householdNeeds } from '../shared/readiness.js';
test('water converts liters and explicit bottle sizes without counting unknown units',()=>{
  assert.equal(waterGallons({quantity:3.785411784,unit:'liters'}),1);
  assert.equal(waterGallons({quantity:10,unit:'bottles'}),0);
  assert.equal(waterGallons({quantity:10,unit:'bottles',gallonsPerUnit:.5}),5);
});
test('expiration uses local calendar date and includes expiry day',()=>{
  const today=new Date(2026,8,12,19,30);
  assert.equal(isExpired('2026-09-12',today),false);
  assert.equal(isExpired('2026-09-11',today),true);
});
test('recurring items become due exactly recurringDays after purchaseDate',()=>{
  const today=new Date(2026,8,12,9,0);
  assert.equal(nextRecurringDate({purchaseDate:'2026-08-13',recurringDays:30}),'2026-09-12');
  assert.equal(nextRecurringDate({purchaseDate:'2026-08-13',recurringDays:0}),null);
  assert.equal(nextRecurringDate({purchaseDate:'',recurringDays:30}),null);
  assert.equal(isRecurringDue({purchaseDate:'2026-08-13',recurringDays:30},today),true);
  assert.equal(isRecurringDue({purchaseDate:'2026-08-14',recurringDays:30},today),false);
  assert.equal(isRecurringDue({purchaseDate:'2026-08-13',recurringDays:0},today),false);
});
test('readiness needs scale with configurable household size and per-person rates',()=>{
  const inventory=[{category:'Food',quantity:10,caloriesPerUnit:2000,name:'Rice'},{category:'Water',quantity:8,unit:'gal',name:'Water'}];
  const solo=computeReadiness({inventory,appliances:[]},settingsSchema.parse({householdSize:1}));
  const family=computeReadiness({inventory,appliances:[]},settingsSchema.parse({householdSize:4}));
  assert.equal(solo.dailyCalorieNeed,2000);assert.equal(family.dailyCalorieNeed,8000);
  assert.equal(solo.foodDays,10);assert.equal(family.foodDays,2.5);
  assert.equal(solo.dailyWaterNeed,1);assert.equal(family.dailyWaterNeed,4);
  assert.equal(solo.waterDays,8);assert.equal(family.waterDays,2);
});
test('readiness falls back to household size until a member opts in',()=>{
  const settings=settingsSchema.parse({householdSize:4});
  const plan=planSchema.parse({family:[{name:'Ada',role:'Adult',dob:''},{name:'Baz',role:'Child',dob:''}]});
  // Two members recorded but no figures given: the flat householdSize math still applies, so an
  // existing household that only ever wrote down names sees no change to its numbers.
  const needs=householdNeeds(plan,settings);
  assert.equal(needs.mode,'household');
  assert.equal(needs.dailyCalorieNeed,8000);
  assert.equal(needs.dailyWaterNeed,4);
  assert.deepEqual(householdNeeds(null,settings),needs);
  const inventory=[{category:'Food',quantity:10,caloriesPerUnit:2000,name:'Rice'}];
  assert.equal(computeReadiness({inventory,appliances:[],plan},settings).foodDays,2.5);
});
test('readiness sums per-member and pet needs once any member carries its own figures',()=>{
  const settings=settingsSchema.parse({householdSize:4});
  const plan=planSchema.parse({family:[
    {name:'Ada',role:'Adult',dob:'',caloriesPerDay:2400,waterGallonsPerDay:1.5},
    {name:'Baz',role:'Toddler',dob:'',caloriesPerDay:1200},
    {name:'Cy',role:'Adult',dob:''},
    {name:'Rex',role:'Dog',dob:'',kind:'pet',caloriesPerDay:700,waterGallonsPerDay:0.25},
  ]});
  const needs=householdNeeds(plan,settings);
  assert.equal(needs.mode,'members');
  assert.equal(needs.people,3);
  assert.equal(needs.pets,1);
  // Ada 2400 + Baz 1200 + Cy at the 2000 default + Rex 700; householdSize 4 is ignored entirely.
  assert.equal(needs.dailyCalorieNeed,6300);
  // Ada 1.5 + Baz at the 1 gal default + Cy 1 + Rex 0.25.
  assert.equal(needs.dailyWaterNeed,3.75);
  const stats=computeReadiness({inventory:[],appliances:[],plan},settings);
  assert.equal(stats.needsMode,'members');
  assert.equal(stats.dailyCalorieNeed,6300);
});
test('a pet with no figures counts for nothing but still switches on per-member mode',()=>{
  const settings=settingsSchema.parse({householdSize:2});
  const plan=planSchema.parse({family:[{name:'Ada',role:'Adult',dob:''},{name:'Rex',role:'Dog',dob:'',kind:'pet'}]});
  const needs=householdNeeds(plan,settings);
  assert.equal(needs.mode,'members');
  // One person at the defaults; the pet contributes nothing until its own figures are entered.
  assert.equal(needs.dailyCalorieNeed,2000);
  assert.equal(needs.dailyWaterNeed,1);
});
test('member figures round-trip blank, zero and null distinctly',()=>{
  const parsed=planSchema.parse({family:[
    {name:'Ada',role:'',dob:''},
    {name:'Baz',role:'',dob:'',caloriesPerDay:0,waterGallonsPerDay:0},
    {name:'Cy',role:'',dob:'',caloriesPerDay:null,waterGallonsPerDay:null},
  ]});
  assert.equal(parsed.family[0].caloriesPerDay,'');
  assert.equal(parsed.family[0].kind,'person');
  // An explicit zero is a real figure and must not collapse back into "use the default".
  assert.equal(parsed.family[1].caloriesPerDay,0);
  // A NULL database column reads back as blank, not as zero.
  assert.equal(parsed.family[2].caloriesPerDay,'');
  const settings=settingsSchema.parse({householdSize:3});
  assert.equal(householdNeeds(parsed,settings).dailyCalorieNeed,2000+0+2000);
  assert.throws(()=>planSchema.parse({family:[{name:'A',role:'',dob:'',kind:'robot'}]}));
  assert.throws(()=>planSchema.parse({family:[{name:'A',role:'',dob:'',caloriesPerDay:-5}]}));
});
test('readiness guards against divide-by-zero when per-person needs are zero',()=>{
  const inventory=[{category:'Food',quantity:5,caloriesPerUnit:500,name:'Bar'}];
  const stats=computeReadiness({inventory,appliances:[]},settingsSchema.parse({caloriesPerPersonPerDay:0,waterGallonsPerPersonPerDay:0}));
  assert.equal(stats.dailyCalorieNeed,0);assert.equal(stats.foodDays,0);assert.equal(stats.waterDays,0);
});
test('stored power runtime accounts for battery usable capacity and inverter efficiency loss',()=>{
  const inventory=[{category:'Power',quantity:1,capacityPerUnit:10,name:'Battery bank'}];
  const appliances=[{watts:100,hours:24,active:true}];
  const ideal=computeReadiness({inventory,appliances},settingsSchema.parse({batteryUsableFraction:1,inverterEfficiency:1}));
  const lossy=computeReadiness({inventory,appliances},settingsSchema.parse({batteryUsableFraction:0.8,inverterEfficiency:0.9}));
  assert.equal(ideal.totalPowerKwh,10);assert.equal(ideal.powerDays,10/2.4);
  assert.equal(lossy.totalPowerKwh,10*0.8*0.9);
  assert.ok(lossy.powerDays<ideal.powerDays);
});
test('fuel hours are grouped by fuel type for explainability',()=>{
  const inventory=[
    {category:'Fuel',quantity:2,hoursPerUnit:10,fuelType:'Propane',name:'Propane tank'},
    {category:'Fuel',quantity:1,hoursPerUnit:6,fuelType:'Gasoline',name:'Gas can'},
    {category:'Fuel',quantity:1,hoursPerUnit:4,name:'Mystery fuel'},
  ];
  const stats=computeReadiness({inventory,appliances:[]},settingsSchema.parse({}));
  assert.equal(stats.totalFuelHours,30);
  assert.deepEqual(stats.fuelByType,{Propane:20,Gasoline:6,Other:4});
});

test('readiness gaps report a shortfall and a shopping suggestion for each unmet goal',()=>{
  const settings=settingsSchema.parse({householdSize:1,caloriesPerPersonPerDay:2000,waterGallonsPerPersonPerDay:1,survivalGoalDays:14,heatGoalHours:36,powerGoalKwh:20,batteryUsableFraction:0.9,inverterEfficiency:0.9});
  const stats=computeReadiness({inventory:[],appliances:[]},settings);
  const gaps=computeReadinessGaps(stats,settings);
  const byKey=Object.fromEntries(gaps.map(g=>[g.key,g]));
  assert.equal(byKey.water.met,false);
  assert.equal(byKey.water.shortfallDays,14);
  assert.equal(byKey.water.suggestedQuantity,14);
  assert.equal(byKey.food.met,false);
  assert.equal(byKey.food.shortfallDays,14);
  assert.equal(byKey.food.suggestedCalories,28000);
  assert.equal(byKey.heat.met,false);
  assert.equal(byKey.heat.shortfallHours,36);
  assert.equal(byKey.power.met,false);
  assert.equal(byKey.power.shortfallKwh,20);
  // Raw stored capacity needed is larger than the usable shortfall, since it still has to survive
  // battery/inverter derating (see computeReadiness's usablePowerKwh).
  assert.equal(byKey.power.suggestedRawKwh,Math.ceil(20/(0.9*0.9)));
});
test('a fully stocked household reports every readiness gap as met',()=>{
  const inventory=[
    {category:'Water',quantity:20,unit:'gal',name:'Water'},
    {category:'Food',quantity:20,caloriesPerUnit:2000,name:'Rice'},
    {category:'Fuel',quantity:10,hoursPerUnit:10,name:'Propane'},
    {category:'Power',quantity:10,capacityPerUnit:10,name:'Battery bank'},
  ];
  const settings=settingsSchema.parse({householdSize:1,survivalGoalDays:5,heatGoalHours:10,powerGoalKwh:5});
  const stats=computeReadiness({inventory,appliances:[]},settings);
  const gaps=computeReadinessGaps(stats,settings);
  assert.ok(gaps.every(g=>g.met));
});

// --- Reminders and seasonal checklists ---
test('reminder schema validates recurringDays and category, defaulting optional fields',()=>{
  const base={id:'r1',title:'Rotate water'};
  assert.equal(reminderSchema.parse(base).category,'Other');
  assert.equal(reminderSchema.parse(base).recurringDays,90);
  assert.equal(reminderSchema.parse({...base,category:'Water Rotation',recurringDays:'180'}).recurringDays,180);
  assert.throws(()=>reminderSchema.parse({...base,category:'Not A Category'}));
  assert.throws(()=>reminderSchema.parse({...base,recurringDays:0}));
});
test('reminders and checklist checks go through the generic add/update/delete collection actions',()=>{
  let state=emptyState();
  state=applyAction(state,{type:'add',collection:'reminders',id:'r1',item:{title:'Test generator',category:'Generator Test',recurringDays:30,startDate:'2026-01-01'}});
  assert.equal(state.reminders[0].title,'Test generator');
  state=applyAction(state,{type:'update',collection:'reminders',id:'r1',item:{lastCompletedDate:'2026-02-01'}});
  assert.equal(state.reminders[0].lastCompletedDate,'2026-02-01');
  state=applyAction(state,{type:'delete',collection:'reminders',id:'r1'});
  assert.equal(state.reminders.length,0);

  state=applyAction(state,{type:'add',collection:'checklist',id:'winter__insulate-pipes',item:{completedAt:'2026-01-05'}});
  assert.equal(state.checklistChecks[0].id,'winter__insulate-pipes');
  state=applyAction(state,{type:'delete',collection:'checklist',id:'winter__insulate-pipes'});
  assert.equal(state.checklistChecks.length,0);
});
test('reminders and checklist checks round-trip through backup export/import',()=>{
  const backup=normalizeBackup({reminders:[{title:'Rotate water',category:'Water Rotation',recurringDays:90}],checklistChecks:[{completedAt:'2026-01-01'}]},()=>'gen-id');
  assert.equal(backup.reminders[0].id,'gen-id');
  const merged=applyAction(emptyState(),{type:'import',backup});
  assert.equal(merged.reminders.length,1);
  assert.equal(merged.checklistChecks.length,1);
});
test('seasonal checklist catalog has four non-empty seasons with unique item IDs',()=>{
  const seasons=checklistCatalog.map(s=>s.season);
  assert.deepEqual(new Set(seasons).size,seasons.length);
  assert.deepEqual(seasons.sort(),['evacuation','severe_weather','summer','winter']);
  for (const {items} of checklistCatalog) {
    assert.ok(items.length>0);
    assert.equal(new Set(items.map(i=>i.id)).size,items.length);
  }
});
test('a reminder is due recurringDays after its last completion, or after startDate if never completed',()=>{
  const reminder={recurringDays:30,startDate:'2026-01-01',lastCompletedDate:'',snoozedUntil:''};
  assert.equal(nextReminderDueDate(reminder),'2026-01-31');
  assert.equal(isReminderOverdue(reminder,new Date(2026,0,30)),false);
  assert.equal(isReminderOverdue(reminder,new Date(2026,0,31)),true);
  const completed={...reminder,lastCompletedDate:'2026-02-01'};
  assert.equal(nextReminderDueDate(completed),'2026-03-03');
  assert.equal(nextReminderDueDate({recurringDays:30,startDate:'',lastCompletedDate:'',snoozedUntil:''}),null);
});
test('snoozing a reminder postpones its due date but never brings it earlier',()=>{
  const reminder={recurringDays:30,startDate:'2026-01-01',lastCompletedDate:'',snoozedUntil:''};
  const due=nextReminderDueDate(reminder);
  const snoozed={...reminder,snoozedUntil:addDaysISO(due,10)};
  assert.equal(effectiveReminderDueDate(snoozed),addDaysISO(due,10));
  assert.equal(isReminderOverdue(snoozed,new Date(2026,0,31)),false);
  const earlierSnooze={...reminder,snoozedUntil:'2026-01-02'};
  assert.equal(effectiveReminderDueDate(earlierSnooze),due);
});
test('API records reminder completion and snooze history, but not plain field edits',async()=>{
  let state=applyAction(emptyState(),{type:'add',collection:'reminders',id:'r1',item:{title:'Rotate water',category:'Water Rotation',recurringDays:90,startDate:'2026-01-01'}});
  let version=0;
  const historyEvents=[];
  const repository={
    async readState(){return {data:structuredClone(state),version};},
    async compareAndSave(expected,next){if(expected!==version)return undefined;state=next;return ++version;},
    async logAudit(){},
    async logReminderHistory(entry){historyEvents.push(entry);},
  };
  const handler=createHandler(repository,()=>({userId:'user-1'}));

  const editRes=response();
  await handler({method:'POST',headers:{'content-type':'application/json'},body:{type:'update',collection:'reminders',id:'r1',item:{notes:'brand refreshed'}}},editRes);
  assert.equal(editRes.code,200);assert.equal(historyEvents.length,0);

  const completeRes=response();
  await handler({method:'POST',headers:{'content-type':'application/json'},body:{type:'update',collection:'reminders',id:'r1',item:{lastCompletedDate:'2026-02-01'}}},completeRes);
  assert.equal(completeRes.code,200);
  assert.deepEqual(historyEvents,[{reminderId:'r1',reminderTitle:'Rotate water',category:'Water Rotation',event:'completed',eventDate:'2026-02-01',userId:'user-1'}]);

  const snoozeRes=response();
  await handler({method:'POST',headers:{'content-type':'application/json'},body:{type:'update',collection:'reminders',id:'r1',item:{snoozedUntil:'2026-02-10'}}},snoozeRes);
  assert.equal(snoozeRes.code,200);
  assert.equal(historyEvents.length,2);
  assert.equal(historyEvents[1].event,'snoozed');
  assert.equal(historyEvents[1].eventDate,'2026-02-10');
});
test('reminder history API enforces membership and returns entries',async()=>{
  const entries=[{reminderId:'r1',reminderTitle:'Rotate water',category:'Water Rotation',event:'completed',eventDate:'2026-02-01',createdAt:'2026-02-01T00:00:00Z',actorEmail:'a@example.com'}];
  const repository={async getMembership(){return {role:'member'};},async listReminderHistory(){return entries;}};
  const ok=response();
  await createReminderHistoryHandler(repository,()=>({userId:'user-1'}))({method:'GET',headers:{}},ok);
  assert.equal(ok.code,200);assert.deepEqual(ok.data.entries,entries);

  const denied=response();
  await createReminderHistoryHandler({...repository,async getMembership(){return undefined;}},()=>({userId:'user-1'}))({method:'GET',headers:{}},denied);
  assert.equal(denied.code,403);

  const unauthed=response();
  await createReminderHistoryHandler(repository,()=>false)({method:'GET',headers:{}},unauthed);
  assert.equal(unauthed.code,401);
});
