import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeImageDataUrl, isDataUrlImage, isManagedImageUrl } from '../server/imageStore.js';

const pngBytes = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a, 0,0,0,0]);
const jpegBytes = Buffer.from([0xff,0xd8,0xff,0xe0, 0,0,0,0]);
const webpBytes = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0,0,0,0]), Buffer.from('WEBP')]);
const dataUrl = (mime, bytes) => `data:${mime};base64,${bytes.toString('base64')}`;

test('decodeImageDataUrl accepts real PNG/JPEG/WebP signatures and rejects everything else', () => {
  assert.equal(decodeImageDataUrl(dataUrl('image/png', pngBytes)).contentType, 'image/png');
  assert.equal(decodeImageDataUrl(dataUrl('image/jpeg', jpegBytes)).contentType, 'image/jpeg');
  assert.equal(decodeImageDataUrl(dataUrl('image/webp', webpBytes)).contentType, 'image/webp');
  assert.throws(() => decodeImageDataUrl('not-a-data-url'));
  assert.throws(() => decodeImageDataUrl(dataUrl('image/png', jpegBytes)), /does not match/);
  assert.throws(() => decodeImageDataUrl('data:image/png;base64,='), /Empty image data/);
  const huge = Buffer.concat([pngBytes, Buffer.alloc(5 * 1024 * 1024)]);
  assert.throws(() => decodeImageDataUrl(dataUrl('image/png', huge)), /too large/);
});

test('isDataUrlImage only matches base64 image data URLs', () => {
  assert.equal(isDataUrlImage(dataUrl('image/png', pngBytes)), true);
  assert.equal(isDataUrlImage(''), false);
  assert.equal(isDataUrlImage('https://example.com/x.png'), false);
  assert.equal(isDataUrlImage(undefined), false);
});

test('isManagedImageUrl only matches this household\'s object storage URLs', () => {
  assert.equal(isManagedImageUrl('https://abc123.public.blob.vercel-storage.com/households/1/inventory/x/y.png', 1), true);
  assert.equal(isManagedImageUrl('https://abc123.public.blob.vercel-storage.com/households/2/inventory/x/y.png', 1), false);
  assert.equal(isManagedImageUrl('https://evil.example.com/households/1/inventory/x/y.png', 1), false);
  assert.equal(isManagedImageUrl('data:image/png;base64,AAAA', 1), false);
  assert.equal(isManagedImageUrl('', 1), false);
  assert.equal(isManagedImageUrl(undefined, 1), false);
});
