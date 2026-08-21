/// <reference types="vite/client" />

// Vite exposes typed env vars on import.meta.env. This reference makes `import.meta.env.*`
// (used by lib/api.ts + lib/supabase.ts) type-check. Kept in lib/ (this slice's ownership).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
