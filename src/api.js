// Every call carries an x-request-id the server echoes back and stamps onto its logs and
// metrics, so a failure a household member reports can be found in the production logs
// without searching by time. The ID identifies the request only; it carries no user or
// household data.
function requestId() {
  try { return crypto.randomUUID(); } catch { return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; }
}

export async function request(path, body, method) {
  const id = requestId();
  const response = await fetch(`/api/${path}`, {
    method:method || (body ? 'POST' : 'GET'), credentials:'same-origin', cache:'no-store',
    headers:{'Content-Type':'application/json', 'x-request-id':id}, body:body ? JSON.stringify(body) : undefined,
    signal:AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(()=>({error:'API unavailable. Run npm run dev for the full app.'}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed.');
    error.status = response.status;
    error.requestId = response.headers.get('x-request-id') || id;
    console.error(JSON.stringify({event:'client_request_failure', requestId:error.requestId, path, status:response.status}));
    throw error;
  }
  return data;
}
