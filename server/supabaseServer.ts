import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';
import type { Request, Response } from 'express';

export interface ServerAuthConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  siteUrl: string;
  projectRef: string;
  isConfigured: boolean;
  oauthProviders: {
    google: boolean;
    microsoft: boolean;
  };
}

let cachedConfig: ServerAuthConfig | null = null;
let adminClient: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;

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
      const json = Buffer.from(base64, 'base64').toString('utf-8');
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
 * Normalizes Supabase Project URL across common server deployment configurations:
 * 1. Strips quotes ("https://..." -> https://...)
 * 2. Handles literal "undefined", "null", "false", "[object Object]"
 * 3. Extracts project ref from accidental PostgreSQL connection strings (postgresql:// or postgres://)
 * 4. Adds https:// if protocol is omitted
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

/**
 * Normalizes and validates Supabase environment variables at startup
 */
export function getValidatedAuthConfig(): ServerAuthConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  // Detect and resolve public anon key across all supported conventions
  const rawAnonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  const anonKey = rawAnonKey.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();

  // Extract project ref if available from JWT
  let projectRef = '';
  if (anonKey && anonKey.includes('.')) {
    try {
      const payload = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64').toString());
      if (payload.ref) projectRef = payload.ref;
    } catch (e) {
      // ignore
    }
  }

  // Resolve Supabase URL across all supported conventions
  const rawSupabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    '';

  const supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl, anonKey);
  if (!projectRef && supabaseUrl) {
    const match = supabaseUrl.match(/^https?:\/\/([^.]+)\.supabase\.co/i);
    if (match && match[1]) projectRef = match[1];
  }

  // Service role key (never expose to client)
  const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const serviceRoleKey = rawServiceKey.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();

  // Site URL for OAuth and email redirect callbacks
  let rawSiteUrl =
    process.env.VITE_SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    process.env.URL ||
    'http://localhost:3000';
  rawSiteUrl = rawSiteUrl.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
  let siteUrl = rawSiteUrl.replace(/\/+$/, '');

  // Check optional OAuth configuration
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_CLIENT_ID !== 'disabled'
  );
  const microsoftConfigured = Boolean(
    process.env.AZURE_CLIENT_ID &&
    process.env.AZURE_CLIENT_SECRET &&
    process.env.AZURE_CLIENT_ID !== 'disabled'
  );

  const isConfigured = isValidSupabaseUrl(supabaseUrl) && Boolean(anonKey && !anonKey.includes('placeholder') && anonKey.length > 20);

  const missingVars: string[] = [];
  if (!isValidSupabaseUrl(supabaseUrl)) missingVars.push('SUPABASE_URL / VITE_SUPABASE_URL');
  if (!anonKey || anonKey.length < 20) missingVars.push('SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY');

  if (missingVars.length > 0) {
    console.info(
      `[Churnveda Auth] Supabase cloud auth credentials (${missingVars.join(', ')}) not configured or invalid in backend environment.`
    );
  } else {
    console.log(
      `\x1b[32m[Churnveda Auth] Supabase Auth initialized for project:\x1b[0m ${supabaseUrl} (Site: ${siteUrl})`
    );
  }

  cachedConfig = {
    supabaseUrl,
    supabaseAnonKey: anonKey,
    supabaseServiceRoleKey: serviceRoleKey,
    siteUrl,
    projectRef,
    isConfigured,
    oauthProviders: {
      google: googleConfigured,
      microsoft: microsoftConfigured
    }
  };

  return cachedConfig;
}

/**
 * Returns the admin Supabase client with service role key (Server-only)
 */
export function getAdminClient(): SupabaseClient | null {
  if (adminClient) return adminClient;
  const config = getValidatedAuthConfig();
  if (!isValidSupabaseUrl(config.supabaseUrl) || (!config.supabaseServiceRoleKey && !config.supabaseAnonKey)) {
    return null;
  }

  const keyToUse = config.supabaseServiceRoleKey || config.supabaseAnonKey;
  try {
    adminClient = createClient(config.supabaseUrl, keyToUse, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    return adminClient;
  } catch (err) {
    console.warn('[Churnveda Auth] Failed to initialize Supabase Admin client:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Returns public Supabase client using anon key
 */
export function getPublicClient(): SupabaseClient | null {
  if (publicClient) return publicClient;
  const config = getValidatedAuthConfig();
  if (!isValidSupabaseUrl(config.supabaseUrl) || !config.supabaseAnonKey) return null;

  try {
    publicClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    return publicClient;
  } catch (err) {
    console.warn('[Churnveda Auth] Failed to initialize Supabase Public client:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Extracts authentication token from Bearer header or Supabase cookies
 */
export function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const sessionHeader = req.headers['x-session-token'] as string;
  if (sessionHeader && !sessionHeader.startsWith('sess_')) {
    return sessionHeader.trim();
  }

  if (req.cookies) {
    if (req.cookies['sb-access-token']) {
      return req.cookies['sb-access-token'];
    }

    // Supabase standard cookie naming pattern: sb-<ref>-auth-token
    const config = getValidatedAuthConfig();
    const cookieName = config.projectRef ? `sb-${config.projectRef}-auth-token` : null;
    if (cookieName && req.cookies[cookieName]) {
      const val = req.cookies[cookieName];
      try {
        const parsed = typeof val === 'string' ? JSON.parse(val) : val;
        if (Array.isArray(parsed) && parsed[0]) return parsed[0];
        if (parsed.access_token) return parsed.access_token;
      } catch (e) {
        if (typeof val === 'string' && val.length > 20) return val;
      }
    }
  }

  return null;
}

/**
 * Securely verifies and gets current user from request via Supabase Auth
 */
export async function getSupabaseUser(req: Request): Promise<User | null> {
  const token = extractAuthToken(req);
  if (!token) return null;

  const client = getAdminClient() || getPublicClient();
  if (!client) return null;

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
      return null;
    }
    return data.user;
  } catch (e) {
    console.error('[Churnveda Auth] Error verifying Supabase token:', e);
    return null;
  }
}

/**
 * Sets session cookies on response
 */
export function setAuthCookies(res: Response, accessToken: string, refreshToken?: string, maxAgeDays = 30) {
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
  const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.APP_URL?.startsWith('https'));

  res.cookie('sb-access-token', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge,
    path: '/'
  });

  if (refreshToken) {
    res.cookie('sb-refresh-token', refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge,
      path: '/'
    });
  }
}

/**
 * Clears session cookies on response
 */
export function clearAuthCookies(res: Response) {
  res.clearCookie('sb-access-token', { path: '/' });
  res.clearCookie('sb-refresh-token', { path: '/' });
  
  const config = getValidatedAuthConfig();
  if (config.projectRef) {
    res.clearCookie(`sb-${config.projectRef}-auth-token`, { path: '/' });
  }
}

/**
 * Validates and normalizes allowed redirect destinations
 */
export function validateRedirectDestination(requestedUrl?: string | null): string {
  if (!requestedUrl) return '/dashboard';

  // Strip leading slash for analysis
  const clean = requestedUrl.trim();

  // Prevent open redirect attacks (no external schemas or double slashes)
  if (clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('//')) {
    return '/dashboard';
  }

  const allowedPrefixes = [
    '/dashboard',
    '/billing',
    '/settings',
    '/pricing',
    '/customers',
    '/action-queue',
    '/closed-loop',
    '/roadmap',
    '/analytics',
    '/roi',
    '/alerts',
    '/playbooks',
    '/integrations'
  ];

  for (const prefix of allowedPrefixes) {
    if (clean === prefix || clean.startsWith(prefix + '/') || clean.startsWith(prefix + '?')) {
      return clean;
    }
  }

  return '/dashboard';
}
