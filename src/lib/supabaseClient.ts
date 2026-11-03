import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Safe placeholder URL and key for unconfigured or initializing states
const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'placeholder-key';

/**
 * Extracts project ref from a Supabase JWT (anon key)
 */
function deriveUrlFromJwt(jwt?: string): string {
  if (!jwt || typeof jwt !== 'string' || !jwt.includes('.')) return '';
  try {
    const parts = jwt.split('.');
    if (parts.length >= 2) {
      let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) {
        base64 += '=';
      }
      const json = typeof atob === 'function'
        ? atob(base64)
        : Buffer.from(base64, 'base64').toString('utf-8');
      const payload = JSON.parse(json);
      if (payload.ref && typeof payload.ref === 'string') {
        return `https://${payload.ref}.supabase.co`;
      }
    }
  } catch {
    // ignore
  }
  return '';
}

/**
 * Validates whether a given string is a valid HTTP or HTTPS URL
 */
export function isValidSupabaseUrl(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.match(/^https?:\/\//i)) return false;
  if (trimmed.includes('placeholder')) return false;
  try {
    const parsed = new URL(trimmed);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Normalizes Supabase Project URL across common deployment mistakes:
 * 1. Strips quotes ("https://..." -> https://...)
 * 2. Handles literal "undefined", "null", "false", "[object Object]"
 * 3. Extracts project ref from PostgreSQL database connection strings (postgresql://... or postgres://...)
 * 4. Adds https:// if protocol is omitted (e.g. xyz.supabase.co)
 * 5. Strips trailing /rest/v1 and slashes
 * 6. Infers from JWT anon key if URL is missing
 */
export function normalizeSupabaseUrl(rawUrl?: string, fallbackAnonKey?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return deriveUrlFromJwt(fallbackAnonKey) || '';
  }

  let url = rawUrl.trim();

  // Strip surrounding quotes or backticks
  url = url.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();

  // Handle literal "undefined", "null", "false", "[object object]", "none"
  if (/^(undefined|null|false|\[object object\]|none)$/i.test(url)) {
    return deriveUrlFromJwt(fallbackAnonKey) || '';
  }

  // Handle accidental PostgreSQL connection string in SUPABASE_URL / VITE_SUPABASE_URL
  // e.g. postgresql://postgres.qjupzvyzvdqvdjygkuxl:pass@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
  // e.g. postgres://postgres:pass@db.qjupzvyzvdqvdjygkuxl.supabase.co:5432/postgres
  if (/^postgres(ql)?:\/\//i.test(url)) {
    const dbHostMatch = url.match(/@(?:db\.)?([a-z0-9_-]+)\.supabase\.co/i);
    if (dbHostMatch && dbHostMatch[1]) {
      return `https://${dbHostMatch[1]}.supabase.co`;
    }
    const poolerMatch = url.match(/postgres\.([a-z0-9_-]+):/i);
    if (poolerMatch && poolerMatch[1]) {
      return `https://${poolerMatch[1]}.supabase.co`;
    }
    const fromJwt = deriveUrlFromJwt(fallbackAnonKey);
    if (fromJwt) return fromJwt;
    return '';
  }

  // If missing protocol (e.g., qjupzvyzvdqvdjygkuxl.supabase.co)
  if (!url.match(/^[a-z]+:\/\//i)) {
    if (url.includes('localhost') || url.startsWith('127.0.0.1')) {
      url = `http://${url}`;
    } else {
      url = `https://${url}`;
    }
  }

  // Strip trailing REST or Auth paths and trailing slashes
  url = url.replace(/\/rest\/v1\/?$/, '').replace(/\/auth\/v1\/?$/, '');
  url = url.replace(/\/+$/, '');

  // Validate format with URL parser
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return deriveUrlFromJwt(fallbackAnonKey) || '';
    }
    return url;
  } catch {
    return deriveUrlFromJwt(fallbackAnonKey) || '';
  }
}

// Browser-safe environment reader: static AST access for Vite build define plugin
const readClientEnvUrl = (): string => {
  try {
    // 1. Static access for Vite compile-time inlining
    // @ts-ignore
    const viteUrl = typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL;
    if (typeof viteUrl === 'string' && viteUrl.trim()) return viteUrl.trim();

    // @ts-ignore
    const nextUrl = typeof import.meta !== 'undefined' && import.meta.env?.NEXT_PUBLIC_SUPABASE_URL;
    if (typeof nextUrl === 'string' && nextUrl.trim()) return nextUrl.trim();

    // 2. Process env fallbacks (Catalyst Slate / Node)
    if (typeof process !== 'undefined' && process.env) {
      const pVite = process.env.VITE_SUPABASE_URL;
      if (typeof pVite === 'string' && pVite.trim()) return pVite.trim();

      const pNext = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (typeof pNext === 'string' && pNext.trim()) return pNext.trim();

      const pBase = process.env.SUPABASE_URL;
      if (typeof pBase === 'string' && pBase.trim()) return pBase.trim();
    }
  } catch {
    // ignore
  }
  return '';
};

const readClientEnvAnonKey = (): string => {
  try {
    // @ts-ignore
    const viteKey = typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY;
    if (typeof viteKey === 'string' && viteKey.trim()) return viteKey.trim();

    // @ts-ignore
    const nextKey = typeof import.meta !== 'undefined' && import.meta.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (typeof nextKey === 'string' && nextKey.trim()) return nextKey.trim();

    if (typeof process !== 'undefined' && process.env) {
      const pVite = process.env.VITE_SUPABASE_ANON_KEY;
      if (typeof pVite === 'string' && pVite.trim()) return pVite.trim();

      const pNext = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (typeof pNext === 'string' && pNext.trim()) return pNext.trim();

      const pBase = process.env.SUPABASE_ANON_KEY;
      if (typeof pBase === 'string' && pBase.trim()) return pBase.trim();
    }
  } catch {
    // ignore
  }
  return '';
};

const readClientEnvSiteUrl = (): string => {
  try {
    // @ts-ignore
    const viteSite = typeof import.meta !== 'undefined' && import.meta.env?.VITE_SITE_URL;
    if (typeof viteSite === 'string' && viteSite.trim()) return viteSite.trim();

    if (typeof process !== 'undefined' && process.env) {
      const pSite = process.env.VITE_SITE_URL || process.env.APP_URL || process.env.URL;
      if (typeof pSite === 'string' && pSite.trim()) return pSite.trim();
    }
  } catch {
    // ignore
  }
  return '';
};

const rawClientUrl = readClientEnvUrl();
const rawClientAnonKey = readClientEnvAnonKey();
const rawClientSiteUrl = readClientEnvSiteUrl();

const envAnonKey = rawClientAnonKey.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
const envUrl = normalizeSupabaseUrl(rawClientUrl, envAnonKey);
const envSiteUrl = rawClientSiteUrl.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();

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

/**
 * Validates public Supabase credentials and returns whether the client is ready
 */
export function validateSupabaseConfig(url?: string, anonKey?: string): { valid: boolean; error?: string; missing?: string[] } {
  const checkKey = (anonKey || configCache?.anonKey || envAnonKey || '').trim();
  const checkUrl = normalizeSupabaseUrl(url || configCache?.url || envUrl || '', checkKey);
  const hasValidUrl = isValidSupabaseUrl(checkUrl);
  const hasValidKey = Boolean(checkKey && !checkKey.includes('placeholder') && checkKey.length > 20);

  if (!hasValidUrl || !hasValidKey) {
    const missing: string[] = [];
    if (!hasValidUrl) {
      if (url || envUrl) {
        missing.push('Valid HTTPS Supabase Project URL (e.g. https://[project-ref].supabase.co)');
      } else {
        missing.push('VITE_SUPABASE_URL (Netlify/Catalyst) or SUPABASE_URL (Railway)');
      }
    }
    if (!hasValidKey) {
      missing.push('VITE_SUPABASE_ANON_KEY (Netlify/Catalyst) or SUPABASE_ANON_KEY (Railway)');
    }
    const msg = `Missing or invalid Supabase configuration: ${missing.join(', ')}.`;
    return { valid: false, error: msg, missing };
  }

  return { valid: true };
}

/**
 * Fetch authoritative runtime public auth configuration from server or client bundle
 */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  if (configCache && isValidSupabaseUrl(configCache.url)) {
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
      const normalizedServerUrl = normalizeSupabaseUrl(data.url, data.anonKey);
      if (data.configured && isValidSupabaseUrl(normalizedServerUrl) && data.anonKey) {
        configCache = {
          url: normalizedServerUrl,
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

  if (valid.valid && isValidSupabaseUrl(envUrl) && envAnonKey) {
    configCache = {
      url: envUrl,
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
    url: isValidSupabaseUrl(envUrl) ? envUrl : '',
    anonKey: envAnonKey || '',
    siteUrl,
    oauthProviders: { google: false, microsoft: false },
    error: valid.error,
    diagnostic: {
      hasUrl: isValidSupabaseUrl(envUrl),
      hasAnonKey: Boolean(envAnonKey && !envAnonKey.includes('placeholder')),
      source: 'none'
    }
  };
}

export function isSupabaseConfigured(): boolean {
  const url = normalizeSupabaseUrl(configCache?.url || envUrl || '', configCache?.anonKey || envAnonKey);
  const anonKey = configCache?.anonKey || envAnonKey || '';
  return isValidSupabaseUrl(url) && Boolean(anonKey && !anonKey.includes('placeholder') && anonKey.length > 20);
}

/**
 * Returns the singleton browser Supabase client.
 * Guarantees zero uncaught exceptions by validating the URL and falling back safely.
 */
export function getSupabase(): SupabaseClient {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const configured = isSupabaseConfigured();
  let targetUrl = PLACEHOLDER_URL;
  let targetKey = PLACEHOLDER_KEY;

  if (configured) {
    const candidateUrl = normalizeSupabaseUrl(configCache?.url || envUrl || '', configCache?.anonKey || envAnonKey);
    if (isValidSupabaseUrl(candidateUrl)) {
      targetUrl = candidateUrl;
      targetKey = configCache?.anonKey || envAnonKey || PLACEHOLDER_KEY;
    }
  }

  try {
    supabaseInstance = createClient(targetUrl, targetKey, {
      auth: {
        persistSession: configured,
        autoRefreshToken: configured,
        detectSessionInUrl: configured,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        flowType: 'pkce'
      }
    });
  } catch (err) {
    console.warn('[Churnveda] Safe Supabase fallback initialized due to invalid configuration.');
    supabaseInstance = createClient(PLACEHOLDER_URL, PLACEHOLDER_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }

  return supabaseInstance;
}

export function updateSupabaseClient(url: string, anonKey: string): SupabaseClient {
  const cleanUrl = normalizeSupabaseUrl(url, anonKey);
  const valid = isValidSupabaseUrl(cleanUrl);
  const targetUrl = valid ? cleanUrl : PLACEHOLDER_URL;
  const targetKey = (anonKey && !anonKey.includes('placeholder')) ? anonKey : PLACEHOLDER_KEY;

  configCache = {
    url: cleanUrl,
    anonKey,
    siteUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
    oauthProviders: { google: false, microsoft: false }
  };

  try {
    supabaseInstance = createClient(targetUrl, targetKey, {
      auth: {
        persistSession: valid,
        autoRefreshToken: valid,
        detectSessionInUrl: valid,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        flowType: 'pkce'
      }
    });
  } catch (err) {
    console.warn('[Churnveda] updateSupabaseClient safe fallback initialized.');
    supabaseInstance = createClient(PLACEHOLDER_URL, PLACEHOLDER_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }

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
