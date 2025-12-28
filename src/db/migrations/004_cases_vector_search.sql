-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to cases (1536 dimensions for OpenAI embeddings)
ALTER TABLE cases ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index for fast similarity search
CREATE INDEX IF NOT EXISTS idx_cases_embedding ON cases
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Function to search similar cases by embedding
CREATE OR REPLACE FUNCTION search_similar_cases(
  query_embedding vector(1536),
  match_count int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  client_email text,
  document_type text,
  verdict text,
  issues jsonb,
  advice_summary text,
  outcome text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.client_email,
    c.document_type,
    c.verdict::text,
    c.issues,
    c.advice_summary,
    c.outcome,
    1 - (c.embedding <=> query_embedding) as similarity
  FROM cases c
  WHERE c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
