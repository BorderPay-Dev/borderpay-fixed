import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './'),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      port: 3000,
      host: true,
    },
    define: {
      // Expose env vars to the app at build time
      'import.meta.env.VITE_SUPABASE_URL':        JSON.stringify(env.VITE_SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY':   JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ''),
      'import.meta.env.VITE_SUPABASE_PROJECT_ID': JSON.stringify(env.VITE_SUPABASE_PROJECT_ID || ''),
      // VITE_SERVER_FUNCTION removed — old make-server proxy no longer used
    },
  };
});
