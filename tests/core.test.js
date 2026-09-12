import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, emptyState, normalizeBackup } from '../shared/schema.js';
import { token, validSession, validPassword, cookie, sameOrigin } from '../server/auth.js';
import { createHandler } from '../api/hub.js';
process.env.SESSION_SECRET='test-only-secret-with-more-than-32-characters';
process.env.HOUSEHOLD_PASSWORD='test-only-household-password';
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
test('buy is atomic and idempotent; ID collisions never overwrite stock',()=>{
  const state=applyAction(emptyState(),{type:'add',collection:'shopping_list',id:item.id,item});
  const bought=applyAction(state,{type:'buy',id:item.id});
  assert.equal(bought.shoppingList.length,0);assert.equal(bought.inventory.length,1);
  assert.deepEqual(applyAction(bought,{type:'buy',id:item.id}),bought);
  state.inventory=bought.inventory;
  assert.throws(()=>applyAction(state,{type:'buy',id:item.id}));
});
test('session rejects tampering, expiry and password rotation',()=>{
  const now=Date.now();const value=token(now);
  const req={headers:{cookie:cookie(value)}};
  assert.equal(validSession(req,now),true);
  assert.equal(validSession(req,now+8*86400000),false);
  assert.equal(validSession({headers:{cookie:cookie(value+'x')}},now),false);
  assert.equal(validPassword('wrong'),false);
  process.env.HOUSEHOLD_PASSWORD+='-rotated';assert.equal(validSession(req,now),false);
});
test('mutations reject cross-site origins and non-JSON forms',()=>{
  assert.equal(sameOrigin({headers:{host:'example.com',origin:'https://evil.com','content-type':'application/json'}}),false);
  assert.equal(sameOrigin({headers:{host:'example.com',origin:'https://example.com','content-type':'text/plain'}}),false);
});
function response(){return {code:200,setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};}
test('API refuses unauthenticated reads',async()=>{
  let called=false;const handler=createHandler({readState(){called=true;}},()=>false);const res=response();
  await handler({method:'GET',headers:{}},res);assert.equal(res.code,401);assert.equal(called,false);
});
test('API reapplies a mutation after a concurrent write without losing either item',async()=>{
  let state=emptyState(),version=0,conflict=true;
  const repository={async readState(){return {data:structuredClone(state),version};},async compareAndSave(expected,next){
    if(conflict){conflict=false;state=applyAction(state,{type:'add',collection:'inventory',id:'other',item:{name:'Other device item'}});version++;return undefined;}
    assert.equal(expected,version);state=next;return ++version;
  }};
  const handler=createHandler(repository,()=>true),res=response();
  await handler({method:'POST',headers:{'content-type':'application/json'},body:{type:'add',collection:'inventory',id:'mine',item:{name:'My item'}}},res);
  assert.equal(res.code,200);assert.deepEqual(state.inventory.map(i=>i.id),['other','mine']);
});
import { waterGallons, isExpired } from '../shared/readiness.js';
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
