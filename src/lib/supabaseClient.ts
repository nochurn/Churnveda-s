import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Browser-safe environment configuration (NEVER expose SUPABASE_SERVICE_ROLE_KEY)
const getMetaEnv = (key: string): string | undefined => {
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
      // @ts-ignore
      const val = import.meta.env[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
  } catch {
    // ignore
  }
  return undefined;
};

const getProcessEnv = (key: string): string | undefined => {
  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      // @ts-ignore
      const val = process.env[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
  } catch {
    // ignore
  }
  return undefined;
};

// Check all supported prefixes: VITE_ (Vite / Netlify), SUPABASE_ (Railway / standard), NEXT_PUBLIC_ (Next.js legacy)
const envUrl =
  getMetaEnv('VITE_SUPABASE_URL') ||
  getMetaEnv('SUPABASE_URL') ||
  getMetaEnv('NEXT_PUBLIC_SUPABASE_URL') ||
  getProcessEnv('VITE_SUPABASE_URL') ||
  getProcessEnv('SUPABASE_URL') ||
  getProcessEnv('NEXT_PUBLIC_SUPABASE_URL');

const envAnonKey =
  getMetaEnv('VITE_SUPABASE_ANON_KEY') ||
  getMetaEnv('SUPABASE_ANON_KEY') ||
  getMetaEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') ||
  getProcessEnv('VITE_SUPABASE_ANON_KEY') ||
  getProcessEnv('SUPABASE_ANON_KEY') ||
  getProcessEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

const envSiteUrl =
  getMetaEnv('VITE_SITE_URL') ||
  getMetaEnv('NEXT_PUBLIC_SITE_URL') ||
  getProcessEnv('VITE_SITE_URL') ||
  getProcessEnv('NEXT_PUBLIC_SITE_URL');

let supabaseInstance: SupabaseClient | null = null;
let configCache: {
  url: string;
  anonKey: string;
  siteUrl: string;
  oauthProviders: { google: boolean; microsoft: boolean };
} | null = null;

export interface AuthConfig {
  configured: boolean;
  url: string;
  anonKey: string;
  siteUrl: string;
  oauthProviders: {
    google: boolean;
    microsoft: boolean;
  };
  error?: string;
  diagnostic?: {
    hasUrl: boolean;
    hasAnonKey: boolean;
    source: 'backend_api' | 'client_bundle' | 'none';
  };
}

export function normalizeSupabaseUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let url = rawUrl.trim();
  url = url.replace(/\/rest\/v1\/?$/, '').replace(/\/auth\/v1\/?$/, '');
  return url.replace(/\/+$/, '');
}

/**
 * Validates public Supabase credentials and returns whether the client is ready
 */
export function validateSupabaseConfig(url?: string, anonKey?: string): { valid: boolean; error?: string; missing?: string[] } {
  const checkUrl = normalizeSupabaseUrl(url || configCache?.url || envUrl || '');
  const checkKey = anonKey || configCache?.anonKey || envAnonKey;

  if (!checkUrl || !checkKey || checkUrl.includes('placeholder') || checkKey.includes('placeholder')) {
    const missing: string[] = [];
    if (!checkUrl || checkUrl.includes('placeholder')) {
      missing.push('VITE_SUPABASE_URL (Netlify) or SUPABASE_URL (Railway)');
    }
    if (!checkKey || checkKey.includes('placeholder')) {
      missing.push('VITE_SUPABASE_ANON_KEY (Netlify) or SUPABASE_ANON_KEY (Railway)');
    }
    const msg = `Missing required Supabase configuration: ${missing.join(', ')}.`;
    return { valid: false, error: msg, missing };
  }

  return { valid: true };
}

/**
 * Fetch authoritative runtime public auth configuration from server or client bundle
 */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  if (configCache) {
    return {
      configured: true,
      url: configCache.url,
      anonKey: configCache.anonKey,
      siteUrl: configCache.siteUrl,
      oauthProviders: configCache.oauthProviders,
      diagnostic: {
        hasUrl: true,
        hasAnonKey: true,
        source: 'backend_api'
      }
    };
  }

  // 1. Try server-side runtime endpoint first (/api/auth/config)
  try {
    const res = await fetch('/api/auth/config');
    if (res.ok) {
      const data = await res.json();
      if (data.configured && data.url && data.anonKey) {
        configCache = {
          url: normalizeSupabaseUrl(data.url),
          anonKey: data.anonKey,
          siteUrl: data.siteUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'),
          oauthProviders: data.oauthProviders || { google: false, microsoft: false }
        };
        updateSupabaseClient(configCache.url, configCache.anonKey);
        return {
          ...data,
          url: configCache.url,
          diagnostic: {
            hasUrl: true,
            hasAnonKey: true,
            source: 'backend_api'
          }
        };
      }
    }
  } catch {
    // server endpoint optional or offline
  }

  // 2. Fall back to client build-time environment variables
  const siteUrl = envSiteUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const valid = validateSupabaseConfig();

  if (valid.valid && envUrl && envAnonKey) {
    configCache = {
      url: normalizeSupabaseUrl(envUrl),
      anonKey: envAnonKey,
      siteUrl,
      oauthProviders: { google: false, microsoft: false }
    };
    updateSupabaseClient(configCache.url, configCache.anonKey);
    return {
      configured: true,
      url: configCache.url,
      anonKey: configCache.anonKey,
      siteUrl,
      oauthProviders: configCache.oauthProviders,
      diagnostic: {
        hasUrl: true,
        hasAnonKey: true,
        source: 'client_bundle'
      }
    };
  }

  return {
    configured: false,
    url: normalizeSupabaseUrl(envUrl || ''),
    anonKey: envAnonKey || '',
    siteUrl,
    oauthProviders: { google: false, microsoft: false },
    error: valid.error,
    diagnostic: {
      hasUrl: Boolean(envUrl && !envUrl.includes('placeholder')),
      hasAnonKey: Boolean(envAnonKey && !envAnonKey.includes('placeholder')),
      source: 'none'
    }
  };
}

export function isSupabaseConfigured(): boolean {
  const url = normalizeSupabaseUrl(configCache?.url || envUrl || '');
  const anonKey = configCache?.anonKey || envAnonKey || '';
  return Boolean(url && anonKey && !url.includes('placeholder') && !anonKey.includes('placeholder'));
}

/**
 * Returns the singleton browser Supabase client
 */
export function getSupabase(): SupabaseClient {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const configured = isSupabaseConfigured();
  const url = configured ? normalizeSupabaseUrl(configCache?.url || envUrl || '') : 'https://placeholder.supabase.co';
  const anonKey = configured ? (configCache?.anonKey || envAnonKey || '') : 'placeholder-key';

  supabaseInstance = createClient(url, anonKey, {
    auth: {
      persistSession: configured,
      autoRefreshToken: configured,
      detectSessionInUrl: configured,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      flowType: 'pkce'
    }
  });

  return supabaseInstance;
}

export function updateSupabaseClient(url: string, anonKey: string): SupabaseClient {
  configCache = {
    url,
    anonKey,
    siteUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
    oauthProviders: { google: false, microsoft: false }
  };
  supabaseInstance = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      flowType: 'pkce'
    }
  });
  return supabaseInstance;
}

// Lazy safe proxy export for standard imports
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabase();
    // @ts-ignore
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  }
});
