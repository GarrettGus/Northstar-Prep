import { validSession } from '../server/auth.js';
import { getMembership, readPlanLocation } from '../server/db.js';
import { beginRequest, logFailure, logIssue, observe } from '../server/observability.js';

// Active National Weather Service alerts for the household's saved location (US only). The
// coordinates come from the stored plan, never from the request, so this cannot be used to make
// the server fetch arbitrary places or URLs. Results are cached per location for a few minutes:
// every member's device polls, and NWS asks clients not to hammer the API.
// NWS_API_BASE exists for the browser suite's local stub; deployments leave it unset.
const nwsBase = () => process.env.NWS_API_BASE || 'https://api.weather.gov';
const alertTtlMs = 5 * 60 * 1000;
const pointTtlMs = 24 * 3600 * 1000;
const cache = new Map();

function userAgent() {
  // NWS rejects requests without a User-Agent and asks for a way to contact the operator.
  const contact = process.env.NWS_CONTACT_EMAIL;
  return `NorthStarPrep/1.0 (household preparedness app${contact ? `; ${contact}` : ''})`;
}

async function nwsJson(path, fetchImpl) {
  const response = await fetchImpl(`${nwsBase()}${path}`, {
    headers: {'User-Agent': userAgent(), Accept: 'application/geo+json'},
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) { const error = new Error(`NWS responded ${response.status}`); error.status = response.status; throw error; }
  return response.json();
}

async function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, {value, expires: Date.now() + ttl});
  return value;
}

const trim = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function simplifyAlerts(collection) {
  const severityRank = {Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4};
  return (collection?.features ?? [])
    .map(feature => feature?.properties ?? {})
    .filter(alert => alert.event && alert.status !== 'Test')
    .map(alert => ({
      id: trim(alert.id, 300),
      event: trim(alert.event, 120),
      severity: trim(alert.severity, 20) || 'Unknown',
      urgency: trim(alert.urgency, 20),
      headline: trim(alert.headline, 300),
      description: trim(alert.description, 4000),
      instruction: trim(alert.instruction, 2000),
      areaDesc: trim(alert.areaDesc, 500),
      onset: alert.onset ?? alert.effective ?? null,
      ends: alert.ends ?? alert.expires ?? null,
    }))
    .sort((a, b) => (severityRank[a.severity] ?? 4) - (severityRank[b.severity] ?? 4));
}

export function createHandler(repository = {getMembership, readPlanLocation}, authenticate = validSession, fetchImpl = (...args) => fetch(...args)) {
  return async function handler(req, res) {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const session = authenticate(req);
    if (!session) { logFailure(request, '/api/alerts', 401); return res.status(401).json({error: 'Please sign in again.'}); }
    if (req.method !== 'GET') return res.status(405).json({error: 'Method not allowed.'});
    let location;
    try {
      if (!await repository.getMembership(session.userId)) return res.status(403).json({error: 'Not a member of this household.'});
      location = await repository.readPlanLocation();
    } catch (error) { logFailure(request, '/api/alerts', 503, error); return res.status(503).json({error: 'Weather alerts are unavailable.'}); }
    if (!location) return res.status(200).json({configured: false, available: false, alerts: []});

    const point = `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
    // The forecast office and place name are a convenience; alerts still work if they fail.
    let office = null, area = '';
    try {
      const info = await cached(`point:${point}`, pointTtlMs, () => nwsJson(`/points/${point}`, fetchImpl));
      const cwa = info?.properties?.cwa;
      if (typeof cwa === 'string' && /^[A-Z]{3}$/.test(cwa)) office = {id: cwa, url: `https://www.weather.gov/${cwa.toLowerCase()}/`};
      const place = info?.properties?.relativeLocation?.properties;
      if (place?.city) area = trim(`${place.city}, ${place.state ?? ''}`.replace(/, $/, ''), 120);
    } catch (error) {
      if (error.status === 404) return res.status(200).json({configured: true, available: false, reason: 'outside_us', alerts: []});
      logIssue(request, '/api/alerts', 'nws_point_failure', error);
    }
    try {
      const alerts = await cached(`alerts:${point}`, alertTtlMs, async () => simplifyAlerts(await nwsJson(`/alerts/active?point=${point}`, fetchImpl)));
      return res.status(200).json({configured: true, available: true, alerts, office, area, fetchedAt: new Date().toISOString()});
    } catch (error) {
      logIssue(request, '/api/alerts', 'nws_alerts_failure', error);
      return res.status(200).json({configured: true, available: false, reason: 'unreachable', alerts: [], office, area});
    }
  };
}

export function clearAlertCache() { cache.clear(); }
export default observe('/api/alerts', createHandler());
