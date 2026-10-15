/**
 * Authentication state (Supabase email/password, password reset, email
 * verification; OAuth providers only when configured through `ENV`).
 */
import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { ENV } from '@/config/env';
import { getSupabase } from '@/lib/supabase';

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in' | 'not_configured';

export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  /** Last auth error message (already human readable from Supabase). */
  error: string | null;
  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string, meta: { uiLocale: string; defaultSourceLanguageCode: string | null; displayName?: string | null }) => Promise<'signed_in' | 'verify_email' | 'error'>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<boolean>;
  updatePassword: (password: string) => Promise<boolean>;
  resendVerification: (email: string) => Promise<boolean>;
  signInWithOAuth: (provider: string) => Promise<boolean>;
  clearError: () => void;
}

let unsubscribe: (() => void) | null = null;

export const useAuth = create<AuthState>()((set, get) => ({
  status: 'loading',
  session: null,
  user: null,
  error: null,
  clearError: () => set({ error: null }),

  bootstrap: async () => {
    const sb = getSupabase();
    if (!sb) {
      set({ status: 'not_configured' });
      return;
    }
    const { data } = await sb.auth.getSession();
    set({ session: data.session, user: data.session?.user ?? null, status: data.session ? 'signed_in' : 'signed_out' });
    unsubscribe?.();
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null, status: session ? 'signed_in' : 'signed_out' });
    });
    unsubscribe = () => sub.subscription.unsubscribe();
  },

  signIn: async (email, password) => {
    const sb = getSupabase();
    if (!sb) return false;
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      set({ error: error.message });
      return false;
    }
    set({ error: null });
    return true;
  },

  signUp: async (email, password, meta) => {
    const sb = getSupabase();
    if (!sb) return 'error';
    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: Linking.createURL('/auth/verify'),
        data: { ui_locale: meta.uiLocale, default_source_language_code: meta.defaultSourceLanguageCode, display_name: meta.displayName ?? null },
      },
    });
    if (error) {
      set({ error: error.message });
      return 'error';
    }
    set({ error: null });
    return data.session ? 'signed_in' : 'verify_email';
  },

  signOut: async () => {
    const sb = getSupabase();
    await sb?.auth.signOut();
    set({ session: null, user: null, status: sb ? 'signed_out' : 'not_configured' });
  },

  resetPassword: async (email) => {
    const sb = getSupabase();
    if (!sb) return false;
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: Linking.createURL('/auth/reset') });
    if (error) set({ error: error.message });
    return !error;
  },

  updatePassword: async (password) => {
    const sb = getSupabase();
    if (!sb) return false;
    const { error } = await sb.auth.updateUser({ password });
    if (error) set({ error: error.message });
    return !error;
  },

  resendVerification: async (email) => {
    const sb = getSupabase();
    if (!sb) return false;
    const { error } = await sb.auth.resend({ type: 'signup', email: email.trim() });
    if (error) set({ error: error.message });
    return !error;
  },

  signInWithOAuth: async (provider) => {
    const sb = getSupabase();
    if (!sb || !ENV.oauthProviders.includes(provider)) return false;
    const redirectTo = Linking.createURL('/auth/callback');
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: provider as 'google' | 'apple' | 'github',
      options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' },
    });
    if (error || !data.url) {
      set({ error: error?.message ?? 'OAuth unavailable' });
      return false;
    }
    if (Platform.OS === 'web') return true; // browser navigates away
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return false;
    const params = Linking.parse(result.url).queryParams ?? {};
    const code = typeof params.code === 'string' ? params.code : null;
    if (code) {
      const { error: exchangeError } = await sb.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        set({ error: exchangeError.message });
        return false;
      }
    }
    return get().status === 'signed_in';
  },
}));
