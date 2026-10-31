import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

function cleanSupabaseUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  let url = rawUrl.trim();
  url = url.replace(/\/rest\/v1\/?$/, '').replace(/\/auth\/v1\/?$/, '');
  return url.replace(/\/+$/, '');
}

export default defineConfig(({ mode }) => {
  // Load environment variables from .env files and system environment (Netlify/CI)
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };

  // Resolve Supabase URL with support for Vite (VITE_), Next.js (NEXT_PUBLIC_), and generic (SUPABASE_)
  const rawSupabaseUrl =
    env.VITE_SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    env.SUPABASE_URL ||
    '';

  // Resolve Supabase Anon Key across all conventions
  const supabaseAnonKey =
    env.VITE_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.SUPABASE_ANON_KEY ||
    '';

  let supabaseUrl = cleanSupabaseUrl(rawSupabaseUrl);

  // If URL wasn't directly provided but anon key has embedded project ref, infer project URL
  if (!supabaseUrl && supabaseAnonKey && supabaseAnonKey.includes('.')) {
    try {
      const payload = JSON.parse(Buffer.from(supabaseAnonKey.split('.')[1], 'base64').toString());
      if (payload.ref) {
        supabaseUrl = `https://${payload.ref}.supabase.co`;
      }
    } catch {
      // ignore
    }
  }

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
