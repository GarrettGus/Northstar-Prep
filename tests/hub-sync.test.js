import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../shared/schema.js';
import { createHandler } from '../api/hub.js';
process.env.SESSION_SECRET='test-only-secret-with-more-than-32-characters';
process.env.DATABASE_URL='postgres://test-only/db';
function response(){return {code:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};}
const signedIn=()=>({userId:'user-1'});
const member={async getMembership(){return {role:'member'};}};

test('a poll that already holds the current version gets an unchanged reply without a full read',async()=>{
  let fullReads=0;
  const repository={...member,async readVersion(){return 7;},async readState(){fullReads++;return {data:emptyState(),version:7};}};
  const res=response();
  await createHandler(repository,signedIn)({method:'GET',url:'/api/hub?since=7',headers:{}},res);
  assert.equal(res.code,200);assert.deepEqual(res.data,{unchanged:true,version:7});assert.equal(fullReads,0);
});

test('a poll with an older version, no version, or a malformed one gets the full household',async()=>{
  const repository={...member,async readVersion(){return 8;},async readState(){return {data:emptyState(),version:8};}};
  for (const url of ['/api/hub?since=7','/api/hub','/api/hub?since=abc','/api/hub?since=-1']) {
    const res=response();
    await createHandler(repository,signedIn)({method:'GET',url,headers:{}},res);
    assert.equal(res.data.version,8,url);assert.ok(res.data.data,url);
  }
});

test('Vercel-style parsed query strings are honored too',async()=>{
  const repository={...member,async readVersion(){return 3;},async readState(){throw new Error('should not read');}};
  const res=response();
  await createHandler(repository,signedIn)({method:'GET',url:'/api/hub?since=3',query:{since:'3'},headers:{}},res);
  assert.equal(res.data.unchanged,true);
});

test('a signed-in account that is no longer a household member can neither read nor write',async()=>{
  let touched=false;
  const repository={
    async getMembership(){return undefined;},
    async readVersion(){touched=true;return 1;},async readState(){touched=true;return {data:emptyState(),version:1};},
    async compareAndSave(){touched=true;return 2;},async logAudit(){touched=true;},
  };
  const handler=createHandler(repository,signedIn);
  for (const req of [
    {method:'GET',url:'/api/hub',headers:{}},
    {method:'GET',url:'/api/hub?since=1',headers:{}},
    {method:'POST',url:'/api/hub',headers:{'content-type':'application/json'},body:{type:'add',collection:'inventory',id:'x',item:{name:'X'}}},
  ]) {
    const res=response();
    await handler(req,res);
    assert.equal(res.code,403,`${req.method} ${req.url}`);
  }
  assert.equal(touched,false);
});
