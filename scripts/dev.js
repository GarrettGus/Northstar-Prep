import { createServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import session from '../api/session.js';
import hub from '../api/hub.js';
const vite = await createViteServer({server:{middlewareMode:true},appType:'spa'});
createServer(async(req,res)=>{
  const path = new URL(req.url,'http://localhost').pathname;
  if (!path.startsWith('/api/')) return vite.middlewares(req,res);
  const handler = {'/api/session':session,'/api/hub':hub}[path];
  res.status = code => {res.statusCode=code;return res;};
  res.json = data => {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if (!handler) return res.status(404).json({error:'Not found.'});
  try {
    let body='';
    for await (const chunk of req) {body+=chunk;if(Buffer.byteLength(body)>3_000_000) return res.status(413).json({error:'Request too large.'});}
    if(body) req.body=JSON.parse(body);
    await handler(req,res);
  } catch {res.status(400).json({error:'Invalid request.'});}
}).listen(5173,'127.0.0.1',()=>console.log('NorthStar Prep: http://127.0.0.1:5173'));
