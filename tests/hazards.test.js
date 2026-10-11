import test from 'node:test';
import assert from 'node:assert/strict';
import { hazardCatalog, hazardChecklists, hazardSupplyTemplates, roundCoordinate } from '../shared/hazards.js';
import { checklistsFor, checklistCatalog } from '../shared/checklists.js';
import { supplyTemplatesFor, findSupplyTemplate, templateToBackup } from '../shared/supplyTemplates.js';
import { planSchema, normalizeBackup, settingsSchema, idSchema } from '../shared/schema.js';
import { createHandler, simplifyAlerts, clearAlertCache } from '../api/_alerts.js';
process.env.SESSION_SECRET='test-only-secret-with-more-than-32-characters';
process.env.DATABASE_URL='postgres://test-only/db';
function response(){return {code:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};}

test('the hazard catalog has unique IDs, a Ready.gov link, and checklist IDs that fit checklist row IDs',()=>{
  const ids=hazardCatalog.map(h=>h.id);
  assert.equal(new Set(ids).size,ids.length);
  for (const hazard of hazardCatalog) {
    assert.match(hazard.readyUrl,/^https:\/\/www\.ready\.gov\//);
    assert.ok(hazard.checklist.length>=4&&hazard.supplies.length>=2,hazard.id);
    const itemIds=hazard.checklist.map(i=>i.id);
    assert.equal(new Set(itemIds).size,itemIds.length,hazard.id);
    for (const item of hazard.checklist) assert.ok(idSchema.safeParse(`hazard-${hazard.id}__${item.id}`).success);
  }
});

test('chosen hazards add their checklists and supply templates after the seasonal and starter ones',()=>{
  const plan={hazards:['wildfire','flood']};
  assert.deepEqual(checklistsFor(null),checklistCatalog);
  // Catalog order, not selection order.
  assert.deepEqual(checklistsFor(plan).slice(checklistCatalog.length).map(c=>c.season),['hazard-flood','hazard-wildfire']);
  assert.deepEqual(hazardChecklists({hazards:['nope']}),[]);
  const templates=supplyTemplatesFor(plan);
  assert.deepEqual(templates.slice(-2).map(t=>t.id),['hazard-flood','hazard-wildfire']);
  assert.equal(findSupplyTemplate('hazard-wildfire',plan).label,'Wildfire Supplies');
  assert.equal(findSupplyTemplate('hazard-wildfire',null),null);
  // A hazard template seeds ordinary inventory rows through the usual backup path.
  const backup=normalizeBackup(templateToBackup(hazardSupplyTemplates({hazards:['earthquake']})[0],settingsSchema.parse({householdSize:3})),()=> 'id');
  assert.deepEqual(backup.inventory.map(i=>[i.name,i.quantity]),[['Gas shut-off wrench',1],['Work gloves',3],['Emergency whistle',3]]);
});

test('plan location is optional, paired, range-checked and rounded; links must be http(s)',()=>{
  assert.deepEqual(planSchema.parse({}).location,{label:'',latitude:'',longitude:''});
  assert.deepEqual(planSchema.parse({location:{latitude:null,longitude:null}}).location,{label:'',latitude:'',longitude:''});
  assert.deepEqual(planSchema.parse({location:{label:' Home ',latitude:'44.97781',longitude:-93.26501}}).location,{label:'Home',latitude:44.98,longitude:-93.27});
  assert.throws(()=>planSchema.parse({location:{latitude:91,longitude:0}}));
  assert.throws(()=>planSchema.parse({hazards:['volcano']}));
  assert.deepEqual(planSchema.parse({hazards:['flood','flood']}).hazards,['flood']);
  assert.throws(()=>planSchema.parse({links:[{title:'x',url:'javascript:alert(1)'}]}));
  assert.throws(()=>planSchema.parse({links:[{title:'',url:'https://example.com'}]}));
  assert.equal(roundCoordinate(-0.004),-0);
});

test('alerts are simplified, test messages dropped, and sorted most severe first',()=>{
  const alerts=simplifyAlerts({features:[
    {properties:{id:'a',event:'Wind Advisory',severity:'Moderate',status:'Actual'}},
    {properties:{id:'b',event:'Tornado Warning',severity:'Extreme',status:'Actual',instruction:'Take cover now.'}},
    {properties:{id:'c',event:'Test Message',severity:'Minor',status:'Test'}},
    {properties:{}},
  ]});
  assert.deepEqual(alerts.map(a=>a.event),['Tornado Warning','Wind Advisory']);
  assert.equal(alerts[0].instruction,'Take cover now.');
});

function nwsFetch(routes,calls=[]){
  return async (url,options)=>{
    calls.push({url,options});
    const path=url.replace('https://api.weather.gov','');
    const route=routes[path];
    if (!route) return {ok:false,status:404,json:async()=>({})};
    if (route instanceof Error) throw route;
    return {ok:true,status:200,json:async()=>route};
  };
}
const member={async getMembership(){return {role:'member'};}};

test('alerts come from the saved plan location, with the forecast office, and are cached',async()=>{
  clearAlertCache();
  const calls=[];
  const fetchImpl=nwsFetch({'/points/44.98,-93.27':{properties:{cwa:'MPX',relativeLocation:{properties:{city:'Minneapolis',state:'MN'}}}},'/alerts/active?point=44.98,-93.27':{features:[{properties:{id:'x',event:'Winter Storm Warning',severity:'Severe'}}]}},calls);
  const handler=createHandler({...member,async readPlanLocation(){return {latitude:44.98,longitude:-93.27};}},()=>({userId:'u'}),fetchImpl);
  let res=response();await handler({method:'GET',url:'/api/alerts?point=1,1',headers:{}},res);
  assert.equal(res.data.available,true);assert.equal(res.data.area,'Minneapolis, MN');
  assert.deepEqual(res.data.office,{id:'MPX',url:'https://www.weather.gov/mpx/'});
  assert.deepEqual(res.data.alerts.map(a=>a.event),['Winter Storm Warning']);
  assert.match(calls[0].options.headers['User-Agent'],/NorthStarPrep/);
  // The request's own query string never chooses the point.
  assert.ok(calls.every(c=>c.url.includes('44.98,-93.27')));
  res=response();await handler({method:'GET',headers:{}},res);
  assert.equal(calls.length,2,'second request served from cache');
});

test('alerts fail soft: no location, outside the US, NWS down, and refuse non-members',async()=>{
  clearAlertCache();
  let res=response();
  await createHandler({...member,async readPlanLocation(){return null;}},()=>({userId:'u'}),()=>{throw new Error('no fetch');})({method:'GET',headers:{}},res);
  assert.deepEqual(res.data,{configured:false,available:false,alerts:[]});
  res=response();
  await createHandler({...member,async readPlanLocation(){return {latitude:51.5,longitude:-0.12};}},()=>({userId:'u'}),nwsFetch({}))({method:'GET',headers:{}},res);
  assert.equal(res.data.reason,'outside_us');
  res=response();
  await createHandler({...member,async readPlanLocation(){return {latitude:40,longitude:-100};}},()=>({userId:'u'}),nwsFetch({'/points/40.00,-100.00':new Error('timeout'),'/alerts/active?point=40.00,-100.00':new Error('timeout')}))({method:'GET',headers:{}},res);
  assert.equal(res.code,200);assert.equal(res.data.available,false);assert.equal(res.data.reason,'unreachable');
  res=response();
  await createHandler({async getMembership(){return undefined;},async readPlanLocation(){throw new Error('should not read');}},()=>({userId:'u'}))({method:'GET',headers:{}},res);
  assert.equal(res.code,403);
  res=response();await createHandler(member,()=>false)({method:'GET',headers:{}},res);assert.equal(res.code,401);
});
