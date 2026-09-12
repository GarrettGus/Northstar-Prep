import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
const lifetime = 7 * 24 * 3600;
function secrets() {
  const password = process.env.HOUSEHOLD_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || password.length < 20 || !secret || secret.length < 32) throw new Error('Household login is not configured.');
  return {password, secret};
}
function digest(value) { return createHash('sha256').update(value).digest(); }
export function validPassword(value) { return typeof value === 'string' && timingSafeEqual(digest(value),digest(secrets().password)); }
function signature(payload) { const {password,secret} = secrets(); return createHmac('sha256',secret).update(`${payload}:${password}`).digest('base64url'); }
export function token(now = Date.now()) { const payload = Buffer.from(JSON.stringify({exp:Math.floor(now/1000)+lifetime})).toString('base64url'); return `${payload}.${signature(payload)}`; }
export function validSession(req, now = Date.now()) {
  try {
    const name = process.env.NODE_ENV === 'production' ? '__Host-northstar' : 'northstar';
    const value = (req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1);
    if (!value || value.length > 1024) return false;
    const [payload,sig,...extra] = value.split('.');
    if (extra.length || !sig || !timingSafeEqual(digest(sig),digest(signature(payload)))) return false;
    const {exp} = JSON.parse(Buffer.from(payload,'base64url').toString());
    return Number.isFinite(exp) && exp > Math.floor(now/1000) && exp <= Math.floor(now/1000)+lifetime;
  } catch { return false; }
}
export function cookie(value, clear = false) {
  const prod = process.env.NODE_ENV === 'production';
  return `${prod ? '__Host-northstar' : 'northstar'}=${value}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${clear ? 0 : lifetime}${prod ? '; Secure' : ''}`;
}
export function loginKey(req) {
  const ip = process.env.VERCEL ? req.headers['x-vercel-forwarded-for'] || 'unknown' : req.socket?.remoteAddress || 'local';
  return createHmac('sha256',secrets().secret).update(String(ip).split(',')[0].trim()).digest('hex');
}
export function sameOrigin(req) {
  // JSON-only mutations plus browser Origin checks prevent cross-site form writes.
  if (!req.headers['content-type']?.startsWith('application/json')) return false;
  if (!req.headers.origin) return !process.env.VERCEL;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}
export function configured() { try { secrets(); return Boolean(process.env.DATABASE_URL); } catch { return false; } }
