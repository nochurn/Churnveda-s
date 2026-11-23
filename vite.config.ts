import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Load environment variables from .env files and system environment
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };

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
      'process.env.VITE_SITE_URL': JSON.stringify(siteUrl),
      'process.env.NEXT_PUBLIC_SITE_URL': JSON.stringify(siteUrl),
      'import.meta.env.VITE_SITE_URL': JSON.stringify(siteUrl),
      'process.env.VITE_API_URL': JSON.stringify(apiUrl),
      'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
      'process.env.VITE_RAZORPAY_KEY_ID': JSON.stringify(razorpayKey),
      'import.meta.env.VITE_RAZORPAY_KEY_ID': JSON.stringify(razorpayKey)
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            'vendor-pdf': ['jspdf', 'jspdf-autotable', 'html2canvas'],
            'vendor-ui': ['lucide-react', 'motion']
          }
        }
      }
    },
    server: {
      // HMR and WebSocket servers are disabled in AI Studio
      hmr: false,
      ws: false,
      watch: null,
    },
  };
});
