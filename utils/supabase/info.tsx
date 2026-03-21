/**
 * BorderPay Africa – Supabase project credentials
 *
 * These are used as FALLBACKS when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 * environment variables are not set.
 *
 * For production deployments, set VITE_* env vars in your hosting provider
 * instead of hardcoding values here.
 */

export const projectId    = import.meta.env.VITE_SUPABASE_PROJECT_ID || 'orwrcpwsffjlvzuraxjc';
export const publicAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY  ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yd3JjcHdzZmZqbHZ6dXJheGpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MTE5OTIsImV4cCI6MjA3ODA4Nzk5Mn0.BK26iyxizBJebGPXl10WUJoiHAXEp84eocN7395KzVw';
