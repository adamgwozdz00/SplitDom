import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_APP_KEY } from "astro:env/server";
import type { Database } from "@/db";

export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !SUPABASE_APP_KEY) {
    return null;
  }
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    // The app key proves a Data API request comes from this Worker (see the api_gate migration).
    global: { headers: { "x-app-key": SUPABASE_APP_KEY } },
    cookies: {
      getAll() {
        return parseCookieHeader(requestHeaders.get("Cookie") ?? "");
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, options);
        });
      },
    },
  });
}
