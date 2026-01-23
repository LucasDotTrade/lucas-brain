-- Phase 1: Mastra Quick Wins - Case Outcome Tracking with Confidence
-- This migration adds:
-- 1. confidence column to cases table
-- 2. case_outcomes table for detailed tracking

-- Add confidence column to cases table
ALTER TABLE cases ADD COLUMN IF NOT EXISTS confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100);

COMMENT ON COLUMN cases.confidence IS 'Confidence score 0-100. High (90+) = clear docs. Medium (70-89) = some uncertainty. Low (<70) = poor OCR.';

-- Create case_outcomes table for detailed tracking
-- This supplements the cases table with per-analysis metadata
CREATE TABLE IF NOT EXISTS case_outcomes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  resource_id TEXT NOT NULL,  -- Client identifier (email or phone)
  verdict TEXT NOT NULL CHECK (verdict IN ('GO', 'WAIT', 'NO_GO')),
  document_type TEXT NOT NULL,
  confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
  trade_route_origin TEXT,
  trade_route_destination TEXT,
  product TEXT,
  issues JSONB,  -- Array of issue types encountered
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for querying by client
CREATE INDEX IF NOT EXISTS idx_case_outcomes_resource_id ON case_outcomes(resource_id);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_case_outcomes_verdict ON case_outcomes(verdict);
CREATE INDEX IF NOT EXISTS idx_case_outcomes_created_at ON case_outcomes(created_at);

COMMENT ON TABLE case_outcomes IS 'Phase 1: Detailed case outcome tracking with confidence scores for learning and analytics';
