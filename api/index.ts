// Vercel serverless entry point.
//
// Vercel runs serverless functions, not a long-running process — so there is NO
// app.listen() here. (That lives in src/server.ts, used for local dev and any
// non-serverless host like Railway/Render.) This module exports the Express app itself
// as the request handler; vercel.json rewrites every path to this function so Express
// does all of its own routing (/health, /docs, /api/v1/*).
//
// It imports the app FROM SOURCE and lets Vercel's @vercel/node builder compile the
// TypeScript itself. We deliberately do NOT import the tsc `dist/*` output: the compiled
// app.js has only a named `createApp` export (no default), and the serverless runtime was
// resolving the function to that file and rejecting it ("The default export must be a
// function or server"). Importing source keeps the whole function in one bundle whose
// default export is unambiguously the Express app.
import { createApp } from "../src/app.js";

export default createApp();
