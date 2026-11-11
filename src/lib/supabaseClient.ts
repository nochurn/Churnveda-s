/**
 * Supabase Compatibility Layer (Adapter)
 *
 * All external Supabase cloud connections have been replaced with Firebase Firestore
 * and Firebase Authentication.
 */

export interface AuthConfigResponse {
  isConfigured: boolean;
  oauthProviders: {
    google: boolean;
    microsoft: boolean;
  };
  developerError: string | null;
  siteUrl?: string;
  diagnostic?: {
    hasUrl: boolean;
    hasAnonKey: boolean;
    source: string;
    framework: string;
    backendReachable: boolean;
  };
}

export function isValidSupabaseUrl(_url?: string): boolean {
  return false;
}

export function normalizeSupabaseUrl(_rawUrl?: string, _fallbackAnonKey?: string): string {
  return '';
}

export function isSupabaseConfigured(): boolean {
  return false;
}

export function checkSupabaseConnection(): { isConfigured: boolean; missing: string[]; hints: string[] } {
  return {
    isConfigured: false,
    missing: [],
    hints: ['Supabase connection removed. App is now powered by Firebase.']
  };
}

export async function fetchAuthConfig(): Promise<AuthConfigResponse> {
  return {
    isConfigured: true,
    oauthProviders: { google: true, microsoft: false },
    developerError: null,
    siteUrl: typeof window !== 'undefined' ? window.location.origin : '',
    diagnostic: {
      hasUrl: false,
      hasAnonKey: false,
      source: 'firebase',
      framework: 'Vite React SPA',
      backendReachable: true
    }
  };
}

export function updateSupabaseClient(_url?: string, _anonKey?: string, _metadata?: any): any {
  return null;
}

export function getSupabase(): any {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: async () => ({ data: null, error: new Error('Supabase removed. Use standard login.') }),
      signUp: async () => ({ data: null, error: new Error('Supabase removed. Use standard signup.') }),
      signOut: async () => ({ error: null }),
      signInWithOAuth: async () => ({ data: null, error: new Error('Supabase OAuth removed.') }),
      signInWithOtp: async () => ({ error: new Error('Supabase OTP removed.') }),
      resend: async () => ({ error: new Error('Supabase resend removed.') }),
      resetPasswordForEmail: async () => ({ error: new Error('Supabase reset removed.') }),
      updateUser: async () => ({ error: new Error('Supabase updateUser removed.') })
    }
  };
}

export const supabase = getSupabase();
