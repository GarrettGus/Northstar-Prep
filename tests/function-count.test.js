import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import handler from '../api/live.js';
process.env.SESSION_SECRET='test-only-secret-with-more-than-32-characters';
process.env.DATABASE_URL='postgres://test-only/db';

// Vercel's Hobby plan refuses a deployment with more than 12 Serverless Functions, and every
// .js file under api/ whose name does not start with "_" becomes one. This failed a real preview
// deployment once; keep new endpoints behind api/live.js (or another dispatcher) instead.
test('the deployment stays within the Hobby plan\'s 12-function limit', () => {
  const functions = readdirSync(new URL('../api/', import.meta.url)).filter(name => name.endsWith('.js') && !name.startsWith('_'));
  assert.ok(functions.length <= 12, `${functions.length} functions: ${functions.join(', ')}`);
});

test('every route api/live.js serves is rewritten to it in vercel.json', () => {
  const {rewrites = []} = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const route of ['go', 'alerts', 'push']) {
    assert.ok(rewrites.some(r => r.source === `/api/${route}` && r.destination === `/api/live?route=${route}`), route);
  }
});

function response(){return {code:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};}
test('api/live.js dispatches by route and 404s anything else', async () => {
  // Unauthenticated, so each real handler answers 401 without touching the database.
  for (const route of ['go', 'alerts', 'push']) {
    const res = response();
    await handler({method: 'GET', url: `/api/live?route=${route}`, query: {route}, headers: {}}, res);
    assert.equal(res.code, 401, route);
  }
  for (const route of ['hub', '__proto__', 'constructor', undefined]) {
    const res = response();
    await handler({method: 'GET', url: '/api/live', query: {route}, headers: {}}, res);
    assert.equal(res.code, 404, String(route));
  }
});
