# Lucas Brain - Mastra AI Agent

## Architecture
- TypeScript/Mastra on Mastra Cloud
- Called by Python backend (lucas.trade)
- Uses Supabase for memory/storage

## Key Files
- src/mastra/agents/index.ts - Lucas agent definition
- src/mastra/tools/index.ts - Tools (call Railway API)
- src/mastra/index.ts - Mastra instance

## Current State
- Rolled back to commit be8173b (working)
- Future: Add Zod schema memory, new tools incrementally

## Do NOT
- Make system prompt too long (causes rate limits)
- Add negative examples (Claude copies them)
- Let Sonnet do date math (see below)

## LLMs Cannot Do Date Math (Lesson Learned)

Sonnet will hallucinate about dates. It sees "January 5th" and "January 2nd" and outputs "has already passed" even when January 5th is in the future.

**What DOESN'T work:**
- Human-readable dates in prompt
- Explicit comparison logic ("if date > today → future")
- Pre-calculated values ("3 days from now")
- Triple redundancy (emoji + VALID + IN THE FUTURE)
- Redacting dates from document text
- Regex post-processing to fix hallucinations

**What WORKS (Suleyman-Gurley approach):**
Take dates away from the LLM entirely:
1. Mastra prompt: "DATES: NOT YOUR JOB"
2. Mastra prompt: "SKIP Timeline section - system generates it"
3. Mastra prompt: "Do NOT say expired, passed, missed, behind"
4. Python generates Timeline section and inserts it

**The lesson:** When an LLM can't do something, don't keep prompting harder. Just take that task away from it. Python handles dates (deterministic), Sonnet handles everything else (creative).
