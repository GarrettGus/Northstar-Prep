import { randomUUID } from 'node:crypto';

export function beginRequest(req, res) {
  const supplied = String(req.headers?.['x-request-id'] || '');
  const id = /^[A-Za-z0-9._-]{1,80}$/.test(supplied) ? supplied : randomUUID();
  res.setHeader('x-request-id', id);
  return { id, started: Date.now() };
}

export function logFailure({ id, started }, route, status, error) {
  console.error(JSON.stringify({
    event: 'request_failure', requestId: id, route, status,
    latencyMs: Date.now() - started,
    error: error instanceof Error ? error.name : 'UnknownError',
  }));
}
