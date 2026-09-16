import { createHmac, timingSafeEqual, createHash, randomBytes, scryptSync } from 'node:crypto';
const lifetime = 7 * 24 * 3600;
const scryptCost = { N: 16384, r: 8, p: 1 };
const keyLength = 64;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Session login is not configured.');
  return secret;
}
function digest(value) { return createHash('sha256').update(value).digest(); }

// --- Per-user password hashing (scrypt; no external dependency). ---
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, keyLength, scryptCost);
  return `scrypt:${scryptCost.N}:${scryptCost.r}:${scryptCost.p}:${salt.toString('hex')}:${hash.toString('hex')}`;
}
export function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltHex, hashHex] = String(stored).split(':');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (!expected.length) return false;
    const actual = scryptSync(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}

// --- Opaque tokens for invitations (random value shown once; only its hash is stored). ---
export function randomToken(bytes = 32) { return randomBytes(bytes).toString('base64url'); }
export function hashToken(value) { return createHash('sha256').update(String(value)).digest('hex'); }

// --- Session cookies signed with SESSION_SECRET, carrying the authenticated user's ID. ---
function signature(payload) { return createHmac('sha256', sessionSecret()).update(payload).digest('base64url'); }
export function token(userId, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(now / 1000) + lifetime })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}
export function validSession(req, now = Date.now()) {
  try {
    const name = process.env.NODE_ENV === 'production' ? '__Host-northstar' : 'northstar';
    const value = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
    if (!value || value.length > 1024) return false;
    const [payload, sig, ...extra] = value.split('.');
    if (extra.length || !sig || !timingSafeEqual(digest(sig), digest(signature(payload)))) return false;
    const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof sub !== 'string' || !sub) return false;
    if (!Number.isFinite(exp) || exp <= Math.floor(now / 1000) || exp > Math.floor(now / 1000) + lifetime) return false;
    return { userId: sub };
  } catch { return false; }
}
export function cookie(value, clear = false) {
  const prod = process.env.NODE_ENV === 'production';
  return `${prod ? '__Host-northstar' : 'northstar'}=${value}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${clear ? 0 : lifetime}${prod ? '; Secure' : ''}`;
}
export function loginKey(req) {
  const ip = process.env.VERCEL ? req.headers['x-vercel-forwarded-for'] || 'unknown' : req.socket?.remoteAddress || 'local';
  return createHmac('sha256', sessionSecret()).update(String(ip).split(',')[0].trim()).digest('hex');
}
export function sameOrigin(req) {
  // JSON-only mutations plus browser Origin checks prevent cross-site form writes.
  if (!req.headers['content-type']?.startsWith('application/json')) return false;
  if (!req.headers.origin) return !process.env.VERCEL;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}
export function configured() { try { sessionSecret(); } catch { return false; } return Boolean(process.env.DATABASE_URL); }
