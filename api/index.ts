// Vercel serverless entry point.
//
// Vercel runs serverless functions, not a long-running process — so there is NO
// app.listen() here. (That lives in src/server.ts, used for local dev and any
// non-serverless host like Railway/Render.) This module exports the Express app itself
// as the request handler; vercel.json rewrites every path to this function so Express
// does all of its own routing (/health, /docs, /api/v1/*).
//
// It imports the COMPILED app produced by vercel.json's buildCommand. The output lives
// under dist/src/* because tsconfig's `include` spans both src and prisma, so tsc's
// rootDir is the project root.
import { createApp } from "../dist/src/app.js";

export default createApp();
