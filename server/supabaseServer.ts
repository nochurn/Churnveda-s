/**
 * Server Auth & Identity Layer
 *
 * All external Supabase cloud connections have been removed and migrated to Firebase.
 */
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

export function isValidSupabaseUrl(_url?: string): boolean {
  return false;
}

export function normalizeSupabaseUrl(_rawUrl?: string, _fallbackAnonKey?: string): string {
  return '';
}

export function getValidatedAuthConfig(): ServerAuthConfig {
  return {
    supabaseUrl: '',
    supabaseAnonKey: '',
    supabaseServiceRoleKey: '',
    siteUrl: process.env.APP_URL || 'http://localhost:3000',
    projectRef: 'firebase',
    isConfigured: true,
    oauthProviders: {
      google: true,
      microsoft: false
    }
  };
}

export function getAdminClient(): any {
  return null;
}

export function getPublicClient(): any {
  return null;
}

export function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const sessionHeader = req.headers['x-session-token'] as string;
  if (sessionHeader) {
    return sessionHeader.trim();
  }

  if (req.cookies && req.cookies['cs-access-token']) {
    return req.cookies['cs-access-token'];
  }
  if (req.cookies && req.cookies['sb-access-token']) {
    return req.cookies['sb-access-token'];
  }

  return null;
}

export async function getSupabaseUser(_req: Request): Promise<any | null> {
  // Supabase connection completely removed
  return null;
}

export function setAuthCookies(res: Response, accessToken: string, _refreshToken?: string, maxAgeDays = 30) {
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
  const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.APP_URL?.startsWith('https'));

  res.cookie('cs-access-token', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge,
    path: '/'
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie('cs-access-token', { path: '/' });
  res.clearCookie('sb-access-token', { path: '/' });
  res.clearCookie('sb-refresh-token', { path: '/' });
}

export function validateRedirectDestination(requestedUrl?: string | null): string {
  if (!requestedUrl) return '/dashboard';
  const clean = requestedUrl.trim();
  if (clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('//')) {
    return '/dashboard';
  }
  return clean.startsWith('/') ? clean : `/${clean}`;
}
