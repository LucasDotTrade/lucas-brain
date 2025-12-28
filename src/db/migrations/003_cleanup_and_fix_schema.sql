-- =====================================================
-- Migration 003: Cleanup unused tables & fix cases schema
-- Run this in Supabase SQL Editor
-- =====================================================

-- PART 1: Drop unused tables
-- These tables have no references in lucas-brain or lucas_api.py
-- =====================================================

DROP TABLE IF EXISTS lcs CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS case_outcomes CASCADE;
DROP TABLE IF EXISTS alerts_sent CASCADE;
DROP TABLE IF EXISTS follow_ups CASCADE;
DROP TABLE IF EXISTS issue_patterns CASCADE;


-- PART 2: Fix cases table schema
-- The cases table exists but needs adjustments for recordCase/recordOutcome tools
-- =====================================================

-- Make advice_given nullable (recordCase uses advice_summary instead)
ALTER TABLE cases ALTER COLUMN advice_given DROP NOT NULL;

-- Add default for advice_given
ALTER TABLE cases ALTER COLUMN advice_given SET DEFAULT '';

-- Add outcome tracking columns (from migration 002)
ALTER TABLE cases ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS bank_feedback text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS lesson_learned text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS outcome_recorded_at timestamptz;


-- PART 3: Add indexes for performance
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_cases_client_email ON cases(client_email);
CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_verdict ON cases(verdict);
CREATE INDEX IF NOT EXISTS idx_cases_outcome ON cases(outcome) WHERE outcome IS NOT NULL;


-- PART 4: Verify schema
-- =====================================================

-- Run this after migration to verify:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'cases'
-- ORDER BY ordinal_position;
