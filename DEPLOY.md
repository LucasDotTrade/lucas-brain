# Deploy Lucas Brain to Railway

## Quick Deploy

1. **Open Railway Dashboard**: https://railway.app/dashboard

2. **Create New Service** in the `robust-love` project:
   - Click "New" → "GitHub Repo"
   - Select `LucasDotTrade/lucas-brain`
   - Railway will auto-detect the Dockerfile

3. **Configure Environment Variables**:
   ```
   DATABASE_URL=<your Supabase postgres connection string>
   ANTHROPIC_API_KEY=<your Anthropic API key>
   OPENAI_API_KEY=<your OpenAI API key for embeddings>
   MODEL=anthropic/claude-sonnet-4-20250514
   PORT=4111
   ```

4. **Configure Networking**:
   - Generate a domain: Click service → Settings → Networking → Generate Domain
   - Note the URL (e.g., `lucas-brain-production.up.railway.app`)

5. **Update lucas.trade**:
   - In Railway, go to the `lucas-core` service
   - Add environment variable:
     ```
     MASTRA_BASE_URL=https://lucas-brain-production.up.railway.app
     ```
   - Redeploy

## Verify Deployment

```bash
# Health check
curl https://lucas-brain-production.up.railway.app/api/health

# Test agent
curl -X POST https://lucas-brain-production.up.railway.app/api/agents/lucasAgent/generate \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}]}'
```

## Rollback

If issues occur, revert `MASTRA_BASE_URL` to:
```
MASTRA_BASE_URL=https://future-yellow-dusk.mastra.cloud
```
