/**
 * Client auth shim. The old Next.js app created a fresh `@supabase/ssr` browser client per call
 * via `createClient()`. In Vite the browser client is a single shared instance (`@/lib/supabase`),
 * so this returns that singleton — keeping the auth component bodies (`const supabase =
 * createClient()`) unchanged.
 */
import { supabase } from "./supabase";

export function createClient() {
  return supabase;
}
