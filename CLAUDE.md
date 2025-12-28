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
