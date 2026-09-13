import { put, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';

// Inventory/shopping images live in Vercel Blob object storage instead of the Postgres
// state document; only the resulting URL and metadata are ever persisted in the database.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const EXTENSION_BY_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const HOSTNAME_PATTERN = /\.public\.blob\.vercel-storage\.com$/;

export function isDataUrlImage(value) {
  return typeof value === 'string' && DATA_URL_PATTERN.test(value);
}

// Sniffs the actual file signature rather than trusting the data URL's declared MIME type.
function sniffImageType(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function decodeImageDataUrl(dataUrl) {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) throw new Error('Unsupported image format. Use PNG, JPEG or WebP.');
  const [, declaredType, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('Empty image data.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Image is too large. Maximum size is 4 MB.');
  const sniffedType = sniffImageType(buffer);
  if (!sniffedType || sniffedType !== declaredType) throw new Error('Image data does not match its declared file type.');
  return { buffer, contentType: sniffedType };
}

function blobToken() {
  const value = process.env.BLOB_READ_WRITE_TOKEN;
  if (!value) { const error = new Error('Object storage is not configured.'); error.status = 503; throw error; }
  return value;
}

export function configured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

// Blob paths are namespaced by household and item so ownership is enforced structurally:
// only images under this household's own prefix are ever written to or deleted for it.
function imagePathname(householdId, itemId, contentType) {
  return `households/${householdId}/inventory/${itemId}/${randomUUID()}.${EXTENSION_BY_TYPE[contentType]}`;
}

export function isManagedImageUrl(value, householdId) {
  if (typeof value !== 'string' || !value) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || !HOSTNAME_PATTERN.test(url.hostname)) return false;
  return url.pathname.includes(`/households/${householdId}/`);
}

export async function storeImage(dataUrl, { householdId, itemId }) {
  const { buffer, contentType } = decodeImageDataUrl(dataUrl);
  const token = blobToken();
  const result = await put(imagePathname(householdId, itemId, contentType), buffer, {
    access: 'public', contentType, token, addRandomSuffix: false,
  });
  return result.url;
}

export async function deleteImage(url, householdId) {
  if (!isManagedImageUrl(url, householdId)) return;
  await del(url, { token: blobToken() });
}
