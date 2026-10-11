import test from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail, appUrl, inviteEmail, resetEmail, backupFailureEmail } from '../server/email.js';
import { createHandler as createMembersHandler } from '../api/members.js';
import { createHandler as createResetHandler } from '../api/password-reset.js';
import { createHandler as createBackupHandler } from '../api/backup.js';
process.env.SESSION_SECRET='test-only-secret-with-more-than-32-characters';
process.env.DATABASE_URL='postgres://test-only/db';
// Links must come from the request unless a test sets APP_URL itself.
delete process.env.APP_URL;delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
function response(){return {code:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};}
const post=(body,extra={})=>({method:'POST',headers:{'content-type':'application/json',origin:'https://prep.example',host:'prep.example',...extra},body,socket:{remoteAddress:'1.2.3.4'}});
function withEnv(values,fn){
  const saved=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
  Object.assign(process.env,values);
  for (const [k,v] of Object.entries(values)) if (v===undefined) delete process.env[k];
  return Promise.resolve(fn()).finally(()=>{for (const [k,v] of Object.entries(saved)) if (v===undefined) delete process.env[k]; else process.env[k]=v;});
}
function mailer(configured=true,fail=false){const sent=[];return {sent,configured:()=>configured,async send(message){if(fail) throw new Error('provider down');sent.push(message);return {sent:true};}};}

test('sendEmail is a no-op without a provider and posts to Resend when configured',async()=>{
  await withEnv({RESEND_API_KEY:undefined,EMAIL_FROM:undefined},async()=>{
    assert.deepEqual(await sendEmail({to:'a@b.c',subject:'s',text:'t'},()=>{throw new Error('must not call');}),{sent:false,reason:'not_configured'});
  });
  await withEnv({RESEND_API_KEY:'key',EMAIL_FROM:'Prep <prep@example.com>',EMAIL_API_BASE:undefined},async()=>{
    const calls=[];
    assert.deepEqual(await sendEmail({to:'a@b.c',subject:'s',text:'t'},async(url,options)=>{calls.push({url,options});return {ok:true};}),{sent:true});
    assert.equal(calls[0].url,'https://api.resend.com/emails');
    assert.equal(calls[0].options.headers.Authorization,'Bearer key');
    assert.deepEqual(JSON.parse(calls[0].options.body),{from:'Prep <prep@example.com>',to:['a@b.c'],subject:'s',text:'t'});
    await assert.rejects(sendEmail({to:'a@b.c',subject:'s',text:'t'},async()=>({ok:false,status:422})));
  });
});

test('links in emails use APP_URL, else the checked Origin',async()=>{
  await withEnv({APP_URL:'https://prep.example.org/',VERCEL_PROJECT_PRODUCTION_URL:undefined},()=>assert.equal(appUrl({headers:{origin:'https://evil.example'}}),'https://prep.example.org'));
  await withEnv({APP_URL:undefined,VERCEL_PROJECT_PRODUCTION_URL:undefined},()=>{
    assert.equal(appUrl({headers:{origin:'https://prep.example'}}),'https://prep.example');
    assert.equal(appUrl({headers:{host:'127.0.0.1:5173'}}),'http://127.0.0.1:5173');
  });
});

test('email templates carry only the link and generic text',()=>{
  const invite=inviteEmail({link:'https://p/?invite=T',role:'owner',expiresAt:'2026-10-18T00:00:00Z'});
  assert.match(invite.text,/an owner/);assert.match(invite.text,/\?invite=T/);
  assert.match(resetEmail({link:'https://p/?reset=R'}).text,/\?reset=R/);
  assert.match(backupFailureEmail({url:'https://p'}).subject,/backup failed/);
});

function membersRepo(){
  return {
    async getMembership(id){return id==='owner'?{role:'owner'}:{role:'member'};},
    async listMembers(){return [];},async listPendingInvitations(){return [];},
    async createInvitation(){},async createPasswordReset(){},
    async findUserById(id){return {id,email:'member@example.com'};},
  };
}

test('an invitation and an owner-made reset link are emailed when possible, and still returned as links',async()=>{
  const mail=mailer();
  const handler=createMembersHandler(membersRepo(),()=>({userId:'owner'}),mail);
  let res=response();await handler(post({type:'invite',email:'new@example.com',role:'member'}),res);
  assert.equal(res.data.emailed,true);assert.ok(res.data.token);
  assert.equal(mail.sent[0].to,'new@example.com');assert.ok(mail.sent[0].text.includes(`https://prep.example/?invite=${res.data.token}`),mail.sent[0].text);
  res=response();await handler(post({type:'reset-link',userId:'00000000-0000-4000-8000-000000000001'}),res);
  assert.equal(res.data.emailed,true);assert.equal(mail.sent[1].to,'member@example.com');assert.ok(mail.sent[1].text.includes(`?reset=${res.data.token}`));
  res=response();await handler({method:'GET',headers:{}},res);assert.equal(res.data.emailEnabled,true);
});

test('a failed or unconfigured send falls back to the manual link without failing the request',async()=>{
  for (const mail of [mailer(false),mailer(true,true)]) {
    const res=response();
    await createMembersHandler(membersRepo(),()=>({userId:'owner'}),mail)(post({type:'invite',email:'new@example.com',role:'member'}),res);
    assert.equal(res.code,200);assert.equal(res.data.emailed,false);assert.ok(res.data.token);
  }
});

function resetRepo(overrides={}){
  const resets=[];
  return {resets,repository:{
    async rateLimit(){return true;},
    async findUserByEmail(email){return email==='owner@example.com'?{id:'u1',email}:undefined;},
    async getMembership(id){return id==='u1'?{role:'owner'}:undefined;},
    async createPasswordReset(row){resets.push(row);},
    ...overrides,
  }};
}

test('a signed-out member can email themselves a reset link, and the reply never reveals whether the account exists',async()=>{
  const mail=mailer();
  const {resets,repository}=resetRepo();
  const handler=createResetHandler(repository,mail);
  const known=response();await handler(post({type:'request',email:'owner@example.com'}),known);
  const unknown=response();await handler(post({type:'request',email:'nobody@example.com'}),unknown);
  assert.equal(known.code,200);assert.deepEqual(known.data,unknown.data);
  assert.equal(resets.length,1);assert.equal(mail.sent.length,1);assert.equal(mail.sent[0].to,'owner@example.com');
  assert.match(mail.sent[0].text,/https:\/\/prep\.example\/\?reset=/);
});

test('reset requests are refused without email, rate-limited, origin-checked and validated',async()=>{
  let res=response();await createResetHandler(resetRepo().repository,mailer(false))(post({type:'request',email:'owner@example.com'}),res);
  assert.equal(res.code,503);
  const keys=[];
  res=response();await createResetHandler(resetRepo({async rateLimit(key){keys.push(key);return !key.startsWith('reset-request:');}}).repository,mailer())(post({type:'request',email:'owner@example.com'}),res);
  assert.equal(res.code,429);assert.equal(keys.length,2);
  res=response();await createResetHandler(resetRepo().repository,mailer())(post({type:'request',email:'not-an-email'}),res);assert.equal(res.code,400);
  res=response();await createResetHandler(resetRepo().repository,mailer())(post({type:'request',email:'owner@example.com'},{origin:'https://evil.example'}),res);assert.equal(res.code,403);
});

test('a failed daily backup emails every owner, and a notice failure never changes the result',async()=>{
  process.env.CRON_SECRET='cron-secret-for-tests';
  const repository={
    async readState(){throw new Error('database down');},
    async insertBackupRecord(){},
    async listMembers(){return [{email:'owner@example.com',role:'owner'},{email:'member@example.com',role:'member'},{email:'second@example.com',role:'owner'}];},
  };
  const cron={method:'GET',headers:{authorization:'Bearer cron-secret-for-tests'}};
  const mail=mailer();
  let res=response();await createBackupHandler(repository,()=>false,{configured:()=>false},mail)(cron,res);
  assert.equal(res.code,500);assert.deepEqual(mail.sent.map(m=>m.to),['owner@example.com','second@example.com']);
  assert.doesNotMatch(mail.sent[0].text,/database down/);
  res=response();await createBackupHandler(repository,()=>false,{configured:()=>false},mailer(true,true))(cron,res);
  assert.equal(res.code,500);assert.equal(res.data.status,'failed');
});
