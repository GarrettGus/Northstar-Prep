import { configured, cookie, loginKey, sameOrigin, token, validPassword, validSession } from '../server/auth.js';
import { rateLimit } from '../server/db.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'GET') return res.status(200).json({authenticated:validSession(req), configured:configured()});
  if (!['POST','DELETE'].includes(req.method)) return res.status(405).json({error:'Method not allowed.'});
  if (!sameOrigin(req)) return res.status(403).json({error:'Request origin rejected.'});
  if (req.method === 'DELETE') { res.setHeader('Set-Cookie',cookie('',true)); return res.status(200).json({ok:true}); }
  if (!configured()) return res.status(503).json({error:'Household login and database need configuration.'});
  if (typeof req.body?.password !== 'string' || req.body.password.length > 500) return res.status(400).json({error:'Enter a valid password.'});
  try {
    if (!await rateLimit(loginKey(req))) return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});
    if (!validPassword(req.body.password)) return res.status(401).json({error:'Incorrect household password.'});
    res.setHeader('Set-Cookie',cookie(token()));
    return res.status(200).json({authenticated:true});
  } catch { return res.status(503).json({error:'Login is unavailable. Check database setup.'}); }
}
