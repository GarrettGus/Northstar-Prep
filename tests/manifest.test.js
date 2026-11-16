import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('public/manifest.webmanifest', root), 'utf8'));

// The PNG signature, then the IHDR chunk: width and height are the first two big-endian words of it.
function pngSize(path) {
  const bytes = readFileSync(new URL(`public${path}`, root));
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${path} is a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test('the manifest meets the install criteria: a name, a start URL, standalone display, and 192 and 512 PNG icons', () => {
  assert.ok(manifest.name && manifest.short_name);
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  const sizes = manifest.icons.filter(icon => icon.type === 'image/png' && (icon.purpose ?? 'any').split(/\s+/).includes('any')).map(icon => icon.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), `any-purpose PNG icons: ${sizes}`);
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'), 'a maskable icon, so Android can shape it');
});

test('every icon the manifest names exists and is really the size it claims', () => {
  for (const icon of manifest.icons) {
    assert.ok(existsSync(new URL(`public${icon.src}`, root)), `${icon.src} exists`);
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(icon.src), [width, height], icon.src);
  }
  assert.deepEqual(pngSize('/icons/apple-touch-icon.png'), [180, 180]);
});

test('the page head links the manifest, a favicon and the iOS home-screen icon, all of which exist', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  for (const href of ['/manifest.webmanifest', '/icons/icon.svg', '/icons/apple-touch-icon.png']) {
    assert.ok(html.includes(`href="${href}"`), `index.html links ${href}`);
    assert.ok(existsSync(new URL(`public${href}`, root)), `${href} exists`);
  }
});

test('the service worker pre-caches only files that exist, so installing it cannot fail', () => {
  const worker = readFileSync(new URL('public/sw.js', root), 'utf8');
  const shell = JSON.parse(worker.match(/const SHELL = (\[.*?\]);/s)[1].replace(/'/g, '"'));
  for (const path of shell) {
    if (path === '/' || path === '/index.html') continue;
    assert.ok(existsSync(new URL(`public${path}`, root)), `${path} exists`);
  }
});
