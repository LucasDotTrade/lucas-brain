#!/usr/bin/env node
/**
 * Backfill embeddings for existing cases
 * Usage: OPENAI_API_KEY=sk-... node scripts/backfill-embeddings.js
 */

const OpenAI = require('openai');
const postgres = require('postgres');

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres.iadnpixgvrdmjijeeufh:zX9o4LKqnFSG7p@aws-1-ap-south-1.pooler.supabase.com:6543/postgres';

async function backfill() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set');
    console.error('Usage: OPENAI_API_KEY=sk-... node scripts/backfill-embeddings.js');
    process.exit(1);
  }

  const sql = postgres(DATABASE_URL);
  const openai = new OpenAI();

  console.log('Fetching cases without embeddings...\n');

  const cases = await sql`
    SELECT id, document_type, issues, advice_summary
    FROM cases
    WHERE embedding IS NULL
  `;

  console.log(`Found ${cases.length} cases to backfill\n`);

  for (const c of cases) {
    try {
      // Build embedding text
      const issuesText = (c.issues || [])
        .map(i => `${i.type}: ${i.description}`)
        .join('. ');
      const embeddingText = `${c.document_type}. ${issuesText}. ${c.advice_summary || ''}`;

      console.log(`Processing case ${c.id}...`);
      console.log(`  Text: ${embeddingText.substring(0, 80)}...`);

      // Generate embedding
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: embeddingText,
      });
      const embedding = response.data[0].embedding;

      // Update case
      await sql`
        UPDATE cases
        SET embedding = ${JSON.stringify(embedding)}::vector
        WHERE id = ${c.id}
      `;

      console.log(`  ✅ Done\n`);
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}\n`);
    }
  }

  // Verify
  const result = await sql`
    SELECT COUNT(*) as total, COUNT(embedding) as with_embedding FROM cases
  `;
  console.log(`\nFinal count: ${result[0].with_embedding}/${result[0].total} cases have embeddings`);

  await sql.end();
}

backfill();
