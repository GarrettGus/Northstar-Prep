// Stand-ins for the third-party services the server calls, so the browser suite never reaches
// the real National Weather Service (or anything else) and its results are deterministic.
// Run as its own process by globalSetup; the dev server is pointed at it through env vars.
import { createServer } from 'node:http';

const port = Number(process.argv[2]);
const known = '44.98,-93.27';

const alerts = {features: [{properties: {
  id: 'urn:test:winter-storm', event: 'Winter Storm Warning', status: 'Actual', severity: 'Severe', urgency: 'Expected',
  headline: 'Winter Storm Warning until Saturday 6 PM', description: 'Heavy snow expected.', instruction: 'Travel only if you must.',
  areaDesc: 'Hennepin', onset: '2026-10-11T00:00:00Z', ends: '2026-10-12T00:00:00Z',
}}]};

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (status, body) => { res.writeHead(status, {'Content-Type': 'application/geo+json'}); res.end(JSON.stringify(body)); };
  if (url.pathname === `/points/${known}`) return json(200, {properties: {cwa: 'MPX', relativeLocation: {properties: {city: 'Minneapolis', state: 'MN'}}}});
  if (url.pathname.startsWith('/points/')) return json(404, {title: 'Data Unavailable For Requested Point'});
  if (url.pathname === '/alerts/active') return json(200, url.searchParams.get('point') === known ? alerts : {features: []});
  json(404, {});
}).listen(port, '127.0.0.1', () => console.log('ready'));
