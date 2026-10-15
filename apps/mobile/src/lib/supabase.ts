/**
 * Supabase auth client for the learner app. Only the public URL + anon key are
 * bundled; RLS protects every learner row server-side. Sessions persist in
 * AsyncStorage on devices and in localStorage on web.
 */
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { ENV } from '@/config/env';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  if (!ENV.supabaseUrl || !ENV.supabaseAnonKey) return null;
  client = createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
    auth: {
      storage: Platform.OS === 'web' ? undefined : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  });
  return client;
}

/** Access token for API calls (refreshes transparently when expired). */
export async function getAccessToken(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}
