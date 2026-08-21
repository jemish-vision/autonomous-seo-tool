import { createClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client — AUTH ONLY. The dashboard's data now comes from the Express API, not
 * from Supabase directly. This client just holds the user's session (sign in / out) and hands its
 * access token to the API client for the Bearer header.
 */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
