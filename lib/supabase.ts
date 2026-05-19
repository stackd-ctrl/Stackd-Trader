// STACKD TRADER — Supabase clients
//
// Browser client: anon key, safe to ship to the client. Used by dashboard
//   reads via RLS "auth read *" policies.
// Server client: service-role key, NEVER import from client components.
//   Used by API routes / server actions that write trades, signals, etc.

import { createBrowserClient, createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// supabase-js v2.105 changed SupabaseClient to take 4 generics; we let
// TypeScript infer the full return type instead of trying to spell it.
export type SupabaseDB = ReturnType<typeof createClient<Database>>;

function publicEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Add them to .env.local.',
    );
  }
  return { url, anonKey };
}

// ---- Browser ----------------------------------------------------------------

let browserSingleton: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function supabaseBrowser() {
  const { url, anonKey } = publicEnv();
  if (browserSingleton) return browserSingleton;
  browserSingleton = createBrowserClient<Database>(url, anonKey);
  return browserSingleton;
}

// ---- Server (RSC / route handler / server action) ---------------------------
// Pass the Next.js `cookies()` helper in so this file stays framework-light.

type CookieStore = {
  get(name: string): { value: string } | undefined;
  set?(name: string, value: string, options?: Record<string, unknown>): void;
};

export function supabaseServer(cookieStore: CookieStore) {
  const { url, anonKey } = publicEnv();
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      get: (name) => cookieStore.get(name)?.value,
      set: (name, value, options) => cookieStore.set?.(name, value, options),
      remove: (name, options) => cookieStore.set?.(name, '', { ...options, maxAge: 0 }),
    },
  });
}

// ---- Service role (server-only, bypasses RLS) -------------------------------

export function supabaseService() {
  const { url } = publicEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY. Required for bot writes.');
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
