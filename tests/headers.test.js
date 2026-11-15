import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const rule = (config.headers ?? []).find(entry => entry.source === '/(.*)');
const header = name => rule?.headers.find(entry => entry.key.toLowerCase() === name.toLowerCase())?.value;

test('every response carries the framing, sniffing, referrer and permission headers', () => {
  assert.ok(rule, 'vercel.json has a headers rule for every path');
  assert.equal(header('X-Frame-Options'), 'DENY');
  assert.equal(header('X-Content-Type-Options'), 'nosniff');
  // `same-origin`, not `no-referrer`: with no-referrer a browser sends `Origin: null` on same-origin
  // POSTs, which the app's own origin check (sameOrigin in server/auth.js) would then reject.
  assert.equal(header('Referrer-Policy'), 'same-origin');
  assert.match(header('Strict-Transport-Security'), /^max-age=\d{7,}/);
  // The two features the app uses (barcode scanning, "use my location") stay available to itself only.
  const permissions = header('Permissions-Policy');
  assert.match(permissions, /camera=\(self\)/);
  assert.match(permissions, /geolocation=\(self\)/);
  assert.match(permissions, /microphone=\(\)/);
});

test('the Content-Security-Policy blocks injected scripts, plugins, framing and foreign origins', () => {
  const policy = Object.fromEntries(header('Content-Security-Policy').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const [name, ...sources] = part.split(/\s+/);
    return [name, sources];
  }));
  assert.deepEqual(policy['default-src'], ["'self'"]);
  // No inline or eval'd script: a script the page's own bundle did not ship does not run.
  assert.deepEqual(policy['script-src'], ["'self'"]);
  assert.deepEqual(policy['object-src'], ["'none'"]);
  assert.deepEqual(policy['frame-ancestors'], ["'none'"]);
  assert.deepEqual(policy['base-uri'], ["'self'"]);
  assert.deepEqual(policy['form-action'], ["'self'"]);
  assert.deepEqual(policy['connect-src'], ["'self'"]);
  // Item images are same-origin data: URLs or the app's own Blob store (see itemSchema.image), nothing else.
  assert.deepEqual(policy['img-src'], ["'self'", 'data:', 'https://*.public.blob.vercel-storage.com']);
  for (const [name, sources] of Object.entries(policy)) {
    assert.ok(!sources.includes("'unsafe-eval'"), `${name} must not allow eval`);
    if (name !== 'style-src') assert.ok(!sources.includes("'unsafe-inline'"), `${name} must not allow inline code`);
    assert.ok(!sources.includes('*') && !sources.includes('http:') && !sources.includes('https:'), `${name} must not allow whole schemes`);
  }
});
