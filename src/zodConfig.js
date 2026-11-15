import { z } from 'zod';

// The browser's Content-Security-Policy (vercel.json) forbids eval. Zod compiles object schemas
// with `new Function` when it can and falls back when it cannot, but probing for it is itself
// reported to the browser as a CSP violation. The client validates small payloads, so turning
// the compiler off costs nothing and keeps the policy free of 'unsafe-eval'. This module must be
// imported before anything that builds a schema (see src/main.jsx); the server keeps the default.
z.config({jitless: true});
