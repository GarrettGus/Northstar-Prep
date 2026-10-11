import test from 'node:test';
import assert from 'node:assert/strict';
import { grabList, goBagCoverage, shelterGuidance, checkinStatuses, lastOutSteps } from '../shared/gotime.js';
import { simulateOutage } from '../shared/outage.js';
import { computeReadiness } from '../shared/readiness.js';
import { settingsSchema, kitSchema } from '../shared/schema.js';
import { createHandler } from '../api/_go.js';
process.env.SESSION_SECRET='test-only-secret-with-more-than-32-characters';
process.env.DATABASE_URL='postgres://test-only/db';
function response(){return {code:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};}

const kit={id:'bag',name:'Go-bag',purpose:'',assignedTo:'Sam',targetContents:[{name:'Flashlight',quantity:1,unit:'units'},{name:'Water',quantity:4,unit:'bottles'}]};
const inventory=[
  {id:'f1',name:'flashlight',quantity:1,unit:'units',category:'Gear',kitId:'bag',location:'Hall closet'},
  {id:'w1',name:'Water',quantity:2,unit:'bottles',category:'Water',kitId:'bag',location:'Hall closet'},
  {id:'w2',name:'Water jug',quantity:5,unit:'gal',category:'Water',kitId:''},
];

test('the grab list lists each kit\'s packed items and flags target rows still missing',()=>{
  const sections=grabList({kits:[kit],inventory,medications:[{id:'m1',name:'Insulin',dose:'10u',person:'Sam',quantityOnHand:3}],family:[{name:'Rex',kind:'pet'}]});
  const bag=sections.find(s=>s.key==='kit:bag');
  assert.equal(bag.title,'Go-bag (Sam)');
  assert.equal(bag.subtitle,'Kept in: Hall closet');
  assert.deepEqual(bag.rows.map(r=>r.label),['flashlight','Water','Water']);
  assert.equal(bag.rows.find(r=>r.missing).detail,'Not packed: need 4 bottles, have 2');
  assert.equal(sections.find(s=>s.key==='medications').rows[0].label,'Insulin 10u');
  assert.ok(sections.find(s=>s.key==='pets'));
  assert.equal(sections.at(-1).key,'essentials');
  // Row IDs are unique, so check-offs never collide.
  const ids=sections.flatMap(s=>s.rows.map(r=>r.id));
  assert.equal(new Set(ids).size,ids.length);
});

test('without kits the grab list falls back to water and medical supplies, and skips pets when there are none',()=>{
  const sections=grabList({kits:[],inventory,family:[{name:'Sam',kind:'person'}]});
  assert.deepEqual(sections.map(s=>s.key),['supplies','essentials']);
  assert.deepEqual(sections[0].rows.map(r=>r.label),['Water','Water jug']);
});

test('go-bag coverage reports each person, and pets only when a kit names them',()=>{
  const full={...kit,id:'full',assignedTo:'alex',targetContents:[]};
  const rows=goBagCoverage([{name:'Sam'},{name:'Alex'},{name:'Jo'},{name:'Rex',kind:'pet'},{name:'  '}],[kit,full],[...inventory,{id:'x',name:'Tent',quantity:1,kitId:'full'}]);
  assert.deepEqual(rows.map(r=>[r.name,r.status]),[['Sam','partial'],['Alex','packed'],['Jo','none']]);
  assert.equal(rows[0].percent,50);
});

test('shelter guidance rations stores over the survival goal and lists loads to shed',()=>{
  const settings=settingsSchema.parse({householdSize:2,survivalGoalDays:3,waterGallonsPerPersonPerDay:1});
  const state={inventory:[{id:'w',name:'Water',quantity:3,unit:'gal',category:'Water'},{id:'b',name:'Battery',quantity:1,category:'Power',capacityPerUnit:2}],appliances:[{id:'a',name:'Space heater',watts:1500,hours:8,priority:'low'},{id:'c',name:'CPAP',watts:40,hours:8,priority:'critical'}],plan:null};
  const guide=shelterGuidance(simulateOutage(state,settings),computeReadiness(state,settings),settings);
  assert.equal(guide.days,3);
  assert.equal(guide.water.perDay,1);assert.equal(guide.water.short,true);
  assert.deepEqual(guide.shedNow,['Space heater']);
  assert.equal(guide.shedsCritical,false);
});

test('kits accept and default an owner',()=>{
  assert.equal(kitSchema.parse({id:'k',name:'Bag'}).assignedTo,'');
  assert.equal(kitSchema.parse({id:'k',name:'Bag',assignedTo:' Sam '}).assignedTo,'Sam');
  assert.ok(lastOutSteps.evacuate.length&&lastOutSteps.shelter.length);
});

function goRepository(){
  const state={activation:null,checkins:new Map(),audit:[]};
  return {state,repository:{
    async getMembership(userId){return ['u1','u2'].includes(userId)?{role:userId==='u1'?'owner':'member'}:undefined;},
    async getActivation(){return state.activation;},
    async startActivation({mode,note,userId}){state.checkins.clear();state.activation={mode,note,startedBy:`${userId}@example.com`,startedAt:'2026-10-11T00:00:00Z'};},
    async endActivation(){const had=Boolean(state.activation);state.activation=null;return had;},
    async upsertCheckin({userId,status,note}){state.checkins.set(userId,{userId,email:`${userId}@example.com`,status,note,updatedAt:'2026-10-11T00:05:00Z'});},
    async listCheckins(){return [...state.checkins.values()];},
    async listMembers(){return [{user_id:'u1',email:'u1@example.com'},{user_id:'u2',email:'u2@example.com'}];},
    async logAudit(entry){state.audit.push(entry);},
  }};
}
const post=(body)=>({method:'POST',headers:{'content-type':'application/json'},body});

test('any member can activate, everyone checks in as themselves, and standing down ends it',async()=>{
  const {state,repository}=goRepository();
  const asMember=createHandler(repository,()=>({userId:'u2'}));
  let res=response();await asMember(post({type:'activate',mode:'evacuate',note:'  Fire order  '}),res);
  assert.equal(res.code,200);assert.equal(res.data.activation.mode,'evacuate');assert.equal(res.data.activation.note,'Fire order');
  res=response();await asMember(post({type:'checkin',status:'need_help',note:'stuck',userId:'u1'}),res);
  // The body's userId is ignored: the check-in belongs to the session's user.
  assert.deepEqual(res.data.checkins.map(c=>[c.userId,c.status]),[['u2','need_help']]);
  assert.equal(res.data.currentUserId,'u2');
  res=response();await createHandler(repository,()=>({userId:'u1'}))(post({type:'stand_down'}),res);
  assert.equal(res.data.activation,null);assert.deepEqual(res.data.checkins,[]);
  assert.deepEqual(state.audit.map(a=>[a.userId,a.action,a.itemName]),[['u2','activate','evacuate'],['u2','checkin','need_help'],['u1','stand_down',null]]);
});

test('go API validates input and refuses non-members, unauthenticated and cross-origin requests',async()=>{
  const {repository}=goRepository();
  const handler=createHandler(repository,()=>({userId:'u1'}));
  let res=response();await handler(post({type:'activate',mode:'panic'}),res);assert.equal(res.code,400);
  res=response();await handler(post({type:'checkin',status:'fine'}),res);assert.equal(res.code,400);
  res=response();await handler(post({type:'nope'}),res);assert.equal(res.code,400);
  res=response();await createHandler(repository,()=>({userId:'stranger'}))({method:'GET',headers:{}},res);assert.equal(res.code,403);
  res=response();await createHandler(repository,()=>false)({method:'GET',headers:{}},res);assert.equal(res.code,401);
  res=response();await handler({method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example',host:'app.example'},body:{type:'stand_down'}},res);assert.equal(res.code,403);
  assert.deepEqual(checkinStatuses,['safe_home','safe_meeting_point','safe_elsewhere','need_help']);
});
