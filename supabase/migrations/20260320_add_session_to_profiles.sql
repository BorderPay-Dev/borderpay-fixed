-- Migration: Add session_data and session_history columns to profiles table
-- These replace the deprecated KV store for production-ready session management

ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS session_data JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS session_history JSONB DEFAULT '[]'::jsonb;

-- Index for faster session lookups
CREATE INDEX IF NOT EXISTS idx_profiles_session_data ON profiles USING GIN (session_data);
