import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, emptyState, normalizeBackup, stateSchema, settingsSchema } from '../shared/schema.js';
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
  const legacy=stateSchema.parse({inventory:[],shoppingList:[],appliances:[],plan:null});
  assert.deepEqual(legacy.settings,settingsSchema.parse({}));
  const configured=applyAction(emptyState(),{type:'settings',settings:{householdSize:2}});
  const backup=normalizeBackup({inventory:[item]},()=>'id');
  const imported=applyAction(configured,{type:'import',backup});
  assert.equal(imported.settings.householdSize,2);
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
import { waterGallons, isExpired, computeReadiness } from '../shared/readiness.js';
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
test('readiness needs scale with configurable household size and per-person rates',()=>{
  const inventory=[{category:'Food',quantity:10,caloriesPerUnit:2000,name:'Rice'},{category:'Water',quantity:8,unit:'gal',name:'Water'}];
  const solo=computeReadiness({inventory,appliances:[]},settingsSchema.parse({householdSize:1}));
  const family=computeReadiness({inventory,appliances:[]},settingsSchema.parse({householdSize:4}));
  assert.equal(solo.dailyCalorieNeed,2000);assert.equal(family.dailyCalorieNeed,8000);
  assert.equal(solo.foodDays,10);assert.equal(family.foodDays,2.5);
  assert.equal(solo.dailyWaterNeed,1);assert.equal(family.dailyWaterNeed,4);
  assert.equal(solo.waterDays,8);assert.equal(family.waterDays,2);
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
