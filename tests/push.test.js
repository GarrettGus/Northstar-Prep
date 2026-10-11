import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { dailyDigest } from '../shared/digest.js';
import { broadcast, sendPush, subscriptionId } from '../server/push.js';
import { createHandler as createPushHandler } from '../api/_push.js';
import { createHandler as createGoHandler } from '../api/_go.js';
import { createHandler as createBackupHandler } from '../api/backup.js';
process.env.SESSION_SECRET='test-only-secret-with-more-than-32-characters';
process.env.DATABASE_URL='postgres://test-only/db';
function response(){return {code:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};}
const post=body=>({method:'POST',headers:{'content-type':'application/json'},body});
const now=new Date(2026,9,11);

test('the daily digest counts what needs attention without naming anything',()=>{
  const state={
    inventory:[
      {id:'a',name:'Secret Rice',expiryDate:'2026-10-01'},
      {id:'b',name:'Beans',expiryDate:'2026-10-15'},
      {id:'c',name:'Bars',expiryDate:'2026-12-01'},
      {id:'d',name:'Filters',recurringDays:30,purchaseDate:'2026-09-01'},
    ],
    reminders:[{id:'r',title:'Test generator',recurringDays:30,startDate:'2026-08-01'}],
    medications:[{id:'m',name:'Insulin',person:'Sam',refillDate:'2026-10-10'},{id:'m2',name:'Other',refillDate:'2026-11-10'}],
  };
  const {counts,notification}=dailyDigest(state,now);
  assert.deepEqual(counts,{overdueReminders:1,refillsDue:1,expired:1,expiringSoon:1,restockDue:1});
  assert.equal(notification.body,'1 maintenance reminder overdue · 1 medication due for refill · 1 item expired · 1 item expiring within 7 days · 1 item due for restock');
  for (const secret of ['Secret Rice','Insulin','Sam','Test generator']) assert.ok(!JSON.stringify(notification).includes(secret),secret);
  // Links to where most of the work is: three supply items outweigh one reminder and one refill.
  assert.equal(notification.url,'/?tab=inventory');
  assert.equal(dailyDigest({reminders:state.reminders,medications:state.medications},now).notification.url,'/?tab=plan');
  assert.equal(dailyDigest({inventory:[{id:'z',name:'Fine'}]},now).notification,null);
});

function browserSubscription(){
  const ecdh=createECDH('prime256v1');ecdh.generateKeys();
  return {id:'s1',endpoint:'https://push.example.com/send/abc',p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')};
}

test('a push is encrypted for the browser key and signed with the VAPID key by the real library',async()=>{
  const keys=webpush.generateVAPIDKeys();
  Object.assign(process.env,{VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:'mailto:owner@example.com'});
  try {
    let details;
    const result=await sendPush(browserSubscription(),{title:'t',body:'b'},(sub,payload,options)=>{details=webpush.generateRequestDetails(sub,payload,options);});
    assert.equal(result,'sent');
    assert.equal(details.endpoint,'https://push.example.com/send/abc');
    assert.equal(details.headers['Content-Encoding'],'aes128gcm');
    assert.match(details.headers.Authorization,/^vapid t=.+, k=/);
    assert.ok(!details.body.toString().includes('"title"'),'payload is encrypted');
  } finally { for (const key of ['VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT']) delete process.env[key]; }
});

test('a broadcast prunes expired subscriptions and keeps going past failures',async()=>{
  const removed=[],errors=[];
  const subs=[{id:'ok'},{id:'gone'},{id:'broken'}];
  const send=async sub=>{ if(sub.id==='gone') return 'gone'; if(sub.id==='broken') throw new Error('500'); return 'sent'; };
  assert.deepEqual(await broadcast(subs,{},{send,remove:async id=>removed.push(id),onError:e=>errors.push(e)}),{sent:1,removed:1,failed:1});
  assert.deepEqual(removed,['gone']);assert.equal(errors.length,1);
  assert.equal(await sendPush({endpoint:'x'},{},async()=>{const e=new Error('gone');e.statusCode=410;throw e;}),'gone');
  await assert.rejects(sendPush({endpoint:'x'},{},async()=>{const e=new Error('bad');e.statusCode=400;throw e;}));
});

function pushRepo(){
  const rows=new Map();
  return {rows,repository:{
    async getMembership(id){return id==='u1'||id==='u2'?{role:'member'}:undefined;},
    async savePushSubscription(row){rows.set(row.id,row);},
    async deletePushSubscription(id,userId){const row=rows.get(id);if(row&&(!userId||row.userId===userId))rows.delete(id);},
    async listPushSubscriptions(_h,{userId=null,excludeUserId=null}={}){return [...rows.values()].filter(r=>(!userId||r.userId===userId)&&(!excludeUserId||r.userId!==excludeUserId));},
  }};
}
const configuredPush=(sent=[])=>({configured:()=>true,publicKey:()=>'PUBLIC',async broadcast(subs,payload){sent.push({subs:subs.map(s=>s.id),payload});return {sent:subs.length,removed:0,failed:0};}});

test('members subscribe and unsubscribe only their own browsers, and can send themselves a test',async()=>{
  const {rows,repository}=pushRepo();const sent=[];
  const asU1=createPushHandler(repository,()=>({userId:'u1'}),configuredPush(sent));
  const sub={endpoint:'https://push.example.com/1',keys:{p256dh:'BAbc-_',auth:'xyz'}};
  let res=response();await asU1({method:'GET',headers:{}},res);assert.deepEqual(res.data,{configured:true,publicKey:'PUBLIC'});
  res=response();await asU1(post({type:'subscribe',subscription:sub,userId:'u2'}),res);assert.equal(res.code,200);
  assert.equal(rows.get(subscriptionId(sub.endpoint)).userId,'u1');
  res=response();await createPushHandler(repository,()=>({userId:'u2'}),configuredPush())(post({type:'unsubscribe',endpoint:sub.endpoint}),res);
  assert.equal(rows.size,1,'another member cannot remove it');
  res=response();await asU1(post({type:'test'}),res);assert.deepEqual(sent[0].subs,[subscriptionId(sub.endpoint)]);
  res=response();await asU1(post({type:'unsubscribe',endpoint:sub.endpoint}),res);assert.equal(rows.size,0);
});

test('push API validates subscriptions and refuses when push is not configured',async()=>{
  const {repository}=pushRepo();
  const handler=createPushHandler(repository,()=>({userId:'u1'}),configuredPush());
  for (const subscription of [{endpoint:'http://insecure.example',keys:{p256dh:'a',auth:'b'}},{endpoint:'https://ok.example',keys:{p256dh:'<script>',auth:'b'}},{endpoint:'https://ok.example'}]) {
    const res=response();await handler(post({type:'subscribe',subscription}),res);assert.equal(res.code,400);
  }
  let res=response();await createPushHandler(repository,()=>({userId:'u1'}),{configured:()=>false,publicKey:()=>null,broadcast})(post({type:'subscribe',subscription:{endpoint:'https://ok.example',keys:{p256dh:'a',auth:'b'}}}),res);
  assert.equal(res.code,503);
  res=response();await createPushHandler(repository,()=>({userId:'stranger'}),configuredPush())({method:'GET',headers:{}},res);assert.equal(res.code,403);
});

test('activating the plan or asking for help pushes everyone else, never the sender, and never the note',async()=>{
  const {repository:pushRows}=pushRepo();
  await pushRows.savePushSubscription({id:'sub-u1',userId:'u1'});await pushRows.savePushSubscription({id:'sub-u2',userId:'u2'});
  const sent=[];
  const goRepository={
    async getMembership(){return {role:'member'};},
    async getActivation(){return null;},async startActivation(){},async endActivation(){return true;},async upsertCheckin(){},
    async listCheckins(){return [];},async listMembers(){return [];},async logAudit(){},
    listPushSubscriptions:pushRows.listPushSubscriptions,deletePushSubscription:pushRows.deletePushSubscription,
  };
  const handler=createGoHandler(goRepository,()=>({userId:'u1'}),configuredPush(sent));
  await handler(post({type:'activate',mode:'evacuate',note:'Meet at 123 Private Lane'}),response());
  await handler(post({type:'checkin',status:'safe_home',note:'fine'}),response());
  await handler(post({type:'checkin',status:'need_help',note:'Ankle broken at the creek'}),response());
  assert.deepEqual(sent.map(s=>[s.payload.tag,s.subs]),[['plan-activation',['sub-u2']],['need-help',['sub-u2']]]);
  assert.equal(sent[0].payload.title,'Household plan activated: Evacuate');
  assert.ok(!JSON.stringify(sent).includes('Private Lane')&&!JSON.stringify(sent).includes('Ankle'));
});

test('the daily cron sends the digest to every subscription only when something is due',async()=>{
  process.env.CRON_SECRET='cron-secret-for-tests';process.env.BACKUP_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  const due={inventory:[{id:'a',name:'Rice',quantity:1,expiryDate:'2000-01-01'}],shoppingList:[],appliances:[],reminders:[],checklistChecks:[],kits:[],medications:[],plan:null,consumption:[],settings:{householdSize:1,caloriesPerPersonPerDay:2000,waterGallonsPerPersonPerDay:1,survivalGoalDays:3,heatGoalHours:24,powerGoalKwh:1,batteryUsableFraction:0.8,inverterEfficiency:0.9}};
  const repo=state=>({
    async readState(){return {data:state,version:1};},async insertBackupRecord(){return 1;},async updateBackupOffSiteStatus(){},async pruneBackups(){return [];},
    async pruneRequestMetrics(){},async recordReadinessSnapshot(){},async pruneReadinessHistory(){},
    async listPushSubscriptions(){return [{id:'s1'},{id:'s2'}];},async deletePushSubscription(){},
  });
  const cron={method:'GET',headers:{authorization:'Bearer cron-secret-for-tests'}};
  const sent=[];
  let res=response();await createBackupHandler(repo(due),()=>false,{configured:()=>false},{configured:()=>false},configuredPush(sent))(cron,res);
  assert.equal(res.code,200);assert.deepEqual(res.data.pushDigest,{sent:2,removed:0,failed:0});assert.equal(sent[0].payload.tag,'daily-digest');
  res=response();await createBackupHandler(repo({...due,inventory:[]}),()=>false,{configured:()=>false},{configured:()=>false},configuredPush())(cron,res);
  assert.equal(res.data.pushDigest,'nothing_due');
  res=response();await createBackupHandler(repo(due),()=>false,{configured:()=>false},{configured:()=>false},{configured:()=>true,async broadcast(){throw new Error('push down');}})(cron,res);
  assert.equal(res.code,200);assert.equal(res.data.status,'success');assert.equal(res.data.pushDigest,'failed');
});
