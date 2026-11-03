import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

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

function cleanSupabaseUrl(rawUrl?: string, anonKey?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return deriveUrlFromJwt(anonKey) || '';
  }
  let url = rawUrl.trim();
  url = url.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
  if (/^(undefined|null|false|\[object object\]|none)$/i.test(url)) {
    return deriveUrlFromJwt(anonKey) || '';
  }
  if (/^postgres(ql)?:\/\//i.test(url)) {
    const dbHostMatch = url.match(/@(?:db\.)?([a-z0-9_-]+)\.supabase\.co/i);
    if (dbHostMatch && dbHostMatch[1]) {
      return `https://${dbHostMatch[1]}.supabase.co`;
    }
    const poolerMatch = url.match(/postgres\.([a-z0-9_-]+):/i);
    if (poolerMatch && poolerMatch[1]) {
      return `https://${poolerMatch[1]}.supabase.co`;
    }
    return deriveUrlFromJwt(anonKey) || '';
  }
  if (!url.match(/^[a-z]+:\/\//i)) {
    if (url.includes('localhost') || url.startsWith('127.0.0.1')) {
      url = `http://${url}`;
    } else {
      url = `https://${url}`;
    }
  }
  url = url.replace(/\/rest\/v1\/?$/, '').replace(/\/auth\/v1\/?$/, '');
  url = url.replace(/\/+$/, '');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return deriveUrlFromJwt(anonKey) || '';
    }
    return url;
  } catch {
    return deriveUrlFromJwt(anonKey) || '';
  }
}

export default defineConfig(({ mode }) => {
  // Load environment variables from .env files and system environment (Netlify/CI)
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };

  // Resolve Supabase Anon Key across all conventions
  const rawAnonKey =
    env.VITE_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.SUPABASE_ANON_KEY ||
    '';
  const supabaseAnonKey = rawAnonKey.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();

  // Resolve Supabase URL with support for Vite (VITE_), Next.js (NEXT_PUBLIC_), and generic (SUPABASE_)
  const rawSupabaseUrl =
    env.VITE_SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    env.SUPABASE_URL ||
    '';

  const supabaseUrl = cleanSupabaseUrl(rawSupabaseUrl, supabaseAnonKey);

  const siteUrl = env.VITE_SITE_URL || env.NEXT_PUBLIC_SITE_URL || env.APP_URL || env.URL || 'http://localhost:3000';
  const apiUrl = env.VITE_API_URL || env.API_URL || '';
  const razorpayKey = env.VITE_RAZORPAY_KEY_ID || env.RAZORPAY_KEY_ID || '';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    define: {
      'process.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
      'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
      'import.meta.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
      'process.env.VITE_SITE_URL': JSON.stringify(siteUrl),
      'process.env.NEXT_PUBLIC_SITE_URL': JSON.stringify(siteUrl),
      'import.meta.env.VITE_SITE_URL': JSON.stringify(siteUrl),
      'process.env.VITE_API_URL': JSON.stringify(apiUrl),
      'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
      'process.env.VITE_RAZORPAY_KEY_ID': JSON.stringify(razorpayKey),
      'import.meta.env.VITE_RAZORPAY_KEY_ID': JSON.stringify(razorpayKey)
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
