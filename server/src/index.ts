/**
 * Entrypoint. `./config/env.js` MUST be imported first (line 1) — it loads and validates
 * process.env before any module that reads it (the Prisma client, the Supabase client).
 */
import { env } from "./config/env.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(env.port, () => {
  console.log(`[api] SEO platform server listening on http://localhost:${env.port}`);
  console.log(`[api] CORS origin: ${env.clientOrigin}  ·  auth required: ${env.authRequired}`);
});
