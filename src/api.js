export async function request(path, body, method) {
  const response = await fetch(`/api/${path}`, {
    method:method || (body ? 'POST' : 'GET'), credentials:'same-origin', cache:'no-store',
    headers:{'Content-Type':'application/json'}, body:body ? JSON.stringify(body) : undefined,
    signal:AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(()=>({error:'API unavailable. Run npm run dev for the full app.'}));
  if (!response.ok) { const error = new Error(data.error || 'Request failed.'); error.status = response.status; throw error; }
  return data;
}
