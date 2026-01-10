# Mastra Framework - Complete Reference

This document catalogs ALL capabilities in the Mastra framework based on source code analysis.

## Package Overview

| Package | Purpose |
|---------|---------|
| `@mastra/core` | Central agent, tools, memory, workflows, processors |
| `@mastra/memory` | Memory class with semantic recall, working memory |
| `@mastra/pg` | PostgreSQL storage adapter |
| `@mastra/evals` | Evaluation and scoring framework |
| `@mastra/rag` | Document processing, GraphRAG, reranking |
| `@mastra/mcp` | Model Context Protocol integration |
| `@mastra/cli` | Command-line interface |
| `@mastra/server` | Server framework |

---

## 1. Memory System

### Memory Configuration Options

```typescript
import { Memory } from '@mastra/memory';
import { PostgresStore, PgVector } from '@mastra/pg';

const memory = new Memory({
  storage: new PostgresStore({ connectionString }),
  vector: new PgVector({ connectionString }),
  embedder: 'openai/text-embedding-3-small',

  // Processors (run on every recall/save)
  processors: [
    new ToolCallFilter(),      // Remove tool calls from context
    new TokenLimiter(100000),  // Cap token count
  ],

  options: {
    // Message History
    lastMessages: 20,  // Keep N most recent messages

    // Working Memory (persistent user profile)
    workingMemory: {
      enabled: true,
      scope: 'resource',  // 'resource' or 'thread'
      template: '# User Profile\n...',  // Markdown template
      // OR use schema:
      schema: z.object({ name: z.string(), ... }),
    },

    // Semantic Recall (vector search)
    semanticRecall: {
      topK: 3,           // Number of similar messages to find
      messageRange: 2,   // Context around each match
      scope: 'resource', // 'resource' or 'thread'
    },
  },
});
```

### Memory Methods

```typescript
// Thread Management
await memory.getThreadById({ threadId });
await memory.saveThread({ thread, memoryConfig });
await memory.updateThread({ id, title, metadata });
await memory.deleteThread(threadId);
await memory.listThreadsByResourceId({ resourceId, perPage, page });

// Message Management
await memory.recall({ threadId, resourceId, vectorSearchString });
await memory.saveMessages({ messages, memoryConfig });
await memory.updateMessages({ messages });
await memory.deleteMessages(['msg-id-1', 'msg-id-2']);

// Working Memory
await memory.getWorkingMemory({ threadId, resourceId });
await memory.updateWorkingMemory({ threadId, resourceId, workingMemory });
await memory.getWorkingMemoryTemplate({ memoryConfig });
await memory.getSystemMessage({ threadId, resourceId });

// Thread Cloning
await memory.cloneThread({ sourceThreadId, newThreadId, title, options });
memory.isClone(thread);
memory.getCloneMetadata(thread);
await memory.getSourceThread(threadId);
await memory.listClones(sourceThreadId, resourceId);
await memory.getCloneHistory(threadId);
```

### Memory Processors

From `@mastra/memory/processors` or `@mastra/core/processors`:

```typescript
import {
  ToolCallFilter,    // Remove tool invocations from history
  TokenLimiter,      // Limit total tokens
} from '@mastra/memory/processors';

// Also available from @mastra/core/processors/memory:
import {
  MessageHistory,    // Control message count
  WorkingMemory,     // Working memory processor
  SemanticRecall,    // Semantic search processor
} from '@mastra/core/processors';
```

---

## 2. Processors (Input/Output)

Processors transform messages before/after LLM calls.

### Security Processors

```typescript
import {
  ModerationProcessor,       // Content moderation
  PIIDetector,               // PII detection/redaction
  PromptInjectionDetector,   // Detect prompt injections
  SystemPromptScrubber,      // Remove system prompts from output
} from '@mastra/core/processors';
```

#### ModerationProcessor

```typescript
const moderation = new ModerationProcessor({
  model: 'openai/gpt-4o-mini',
  categories: ['hate', 'violence', 'sexual', 'self-harm'],
  threshold: 0.5,
  strategy: 'block',  // 'block' | 'warn' | 'filter'
});
```

#### PIIDetector

```typescript
const pii = new PIIDetector({
  model: 'openai/gpt-4o-mini',
  detectionTypes: ['email', 'phone', 'credit-card', 'ssn', 'api-key'],
  threshold: 0.6,
  strategy: 'redact',  // 'block' | 'warn' | 'filter' | 'redact'
  redactionMethod: 'mask',  // 'mask' | 'hash' | 'remove' | 'placeholder'
});
```

#### PromptInjectionDetector

```typescript
const injection = new PromptInjectionDetector({
  model: 'openai/gpt-4o-mini',
  threshold: 0.7,
  strategy: 'block',
});
```

### Utility Processors

```typescript
import {
  TokenLimiter,           // Limit input tokens
  ToolCallFilter,         // Filter tool calls from memory
  UnicodeNormalizer,      // Normalize unicode text
  StructuredOutputProcessor,
  BatchPartsProcessor,    // Batch stream chunks
  LanguageDetector,       // Detect/translate language
} from '@mastra/core/processors';
```

#### TokenLimiter

```typescript
const limiter = new TokenLimiter(100000, {
  strategy: 'oldest',     // 'oldest' | 'newest' | 'smart'
  preserveSystemMessages: true,
});
```

#### LanguageDetector

```typescript
const langDetector = new LanguageDetector({
  model: 'openai/gpt-4o-mini',
  targetLanguage: 'en',
  translateToTarget: true,
});
```

### Using Processors with Agent

```typescript
const agent = new Agent({
  name: 'Lucas',
  model: 'anthropic/claude-sonnet-4-20250514',
  inputProcessors: [
    new PIIDetector({ ... }),
    new ModerationProcessor({ ... }),
  ],
  outputProcessors: [
    new SystemPromptScrubber({ ... }),
  ],
  maxProcessorRetries: 3,  // Retry on processor abort
});
```

---

## 3. Evaluation & Scoring

### Available Scorers

From `@mastra/evals/scorers/llm`:

```typescript
import {
  createAnswerRelevancyScorer,
  createAnswerSimilarityScorer,
  createFaithfulnessScorer,
  createBiasScorer,
  createHallucinationScorer,
  createToxicityScorer,
  createToolCallAccuracyScorer,
  createContextRelevanceScorer,
  createContextPrecisionScorer,
  createNoiseSensitivityScorer,
  createPromptAlignmentScorer,
} from '@mastra/evals/scorers/llm';
```

### Using Scorers with Agent

```typescript
import { createFaithfulnessScorer, createToxicityScorer } from '@mastra/evals/scorers/llm';

const agent = new Agent({
  name: 'Lucas',
  model: 'anthropic/claude-sonnet-4-20250514',
  scorers: {
    faithfulness: createFaithfulnessScorer({ model: 'openai/gpt-4o-mini' }),
    toxicity: createToxicityScorer({ model: 'openai/gpt-4o-mini' }),
  },
});

// Scores are computed after each generation
const result = await agent.generate({ messages });
console.log(result.scores);  // { faithfulness: 0.95, toxicity: 0.02 }
```

### Scoring Hooks

```typescript
import { registerHook, AvailableHooks } from '@mastra/core/hooks';

registerHook(AvailableHooks.ON_SCORER_RUN, (data) => {
  console.log('Score result:', data);
  // Log to external system, trigger alerts, etc.
});
```

---

## 4. RAG (Retrieval Augmented Generation)

From `@mastra/rag`:

```typescript
import {
  MDocument,      // Document class
  GraphRAG,       // Graph-based RAG
  rerank,         // Reranking utilities
} from '@mastra/rag';
```

### Document Processing

```typescript
import { MDocument } from '@mastra/rag';

const doc = new MDocument({
  content: 'Document text...',
  metadata: { source: 'file.pdf' },
});

// Chunk document
const chunks = await doc.chunk({
  strategy: 'recursive',
  size: 512,
  overlap: 50,
});

// Embed chunks
const embeddings = await doc.embed({
  embedder: 'openai/text-embedding-3-small',
});
```

### GraphRAG

```typescript
import { GraphRAG } from '@mastra/rag';

const graphRag = new GraphRAG({
  storage: postgresStore,
  vector: pgVector,
});

// Build knowledge graph from documents
await graphRag.ingest(documents);

// Query with graph traversal
const results = await graphRag.query('What are the key concepts?');
```

### RAG Tools

```typescript
import { createRAGTool, createVectorQueryTool } from '@mastra/rag/tools';

const ragTool = createRAGTool({
  vectorStore: pgVector,
  indexName: 'documents',
  topK: 5,
});
```

---

## 5. Workflows

Step-based execution with suspend/resume.

```typescript
import { createWorkflow, createStep } from '@mastra/core/workflows';

const validateStep = createStep({
  id: 'validate',
  description: 'Validate input data',
  inputSchema: z.object({ data: z.string() }),
  outputSchema: z.object({ valid: z.boolean() }),
  execute: async ({ input }) => {
    return { valid: input.data.length > 0 };
  },
});

const workflow = createWorkflow({
  id: 'my-workflow',
  steps: [validateStep, processStep, saveStep],
});

// Execute workflow
const result = await workflow.execute({ data: 'test' });

// Workflows can suspend and resume
// Great for human-in-the-loop processes
```

### Workflows as Processors

Workflows can be used as input/output processors:

```typescript
const agent = new Agent({
  inputProcessors: [validationWorkflow],
  outputProcessors: [postProcessWorkflow],
});
```

---

## 6. Agent Features

### Model Fallbacks

```typescript
const agent = new Agent({
  model: [
    { id: 'primary', model: 'anthropic/claude-sonnet-4-20250514', maxRetries: 2 },
    { id: 'fallback', model: 'openai/gpt-4o', maxRetries: 3 },
  ],
});
```

### Voice (TTS/STT)

```typescript
import { CompositeVoice } from '@mastra/core/voice';
import { ElevenLabsVoice } from '@mastra/voice-elevenlabs';
import { DeepgramVoice } from '@mastra/voice-deepgram';

const agent = new Agent({
  voice: new CompositeVoice({
    tts: new ElevenLabsVoice({ ... }),
    stt: new DeepgramVoice({ ... }),
  }),
});

// Text to speech
const audio = await agent.voice.speak('Hello!');

// Speech to text
const text = await agent.voice.listen(audioBuffer);
```

### Agent Networks (Multi-Agent)

```typescript
const network = await agent.network({
  agents: { researcher, writer, reviewer },
  coordinator: 'researcher',
});

// Agents can delegate to each other
const result = await network.execute({
  messages: [{ role: 'user', content: 'Write an article about AI' }],
});
```

### Dynamic Instructions

```typescript
const agent = new Agent({
  instructions: async ({ threadId, resourceId }) => {
    const userData = await fetchUserData(resourceId);
    return `You are helping ${userData.name}. Their timezone is ${userData.timezone}.`;
  },
});
```

---

## 7. Storage (PostgresStore)

### Direct Database Access

```typescript
const store = new PostgresStore({ connectionString });

// Execute custom queries
const rows = await store.db.any('SELECT * FROM my_table WHERE user_id = $1', [userId]);
const row = await store.db.one('SELECT * FROM users WHERE id = $1', [id]);
await store.db.none('DELETE FROM cache WHERE expires_at < NOW()');

// Transaction support
await store.db.tx(async (t) => {
  await t.none('INSERT INTO ...');
  await t.none('UPDATE ...');
});
```

### Domain Stores

```typescript
// Access specific domains
const memoryStore = await store.getStore('memory');
const workflowStore = await store.getStore('workflows');
const scoresStore = await store.getStore('scores');
const observabilityStore = await store.getStore('observability');
const agentsStore = await store.getStore('agents');
```

---

## 8. What Lucas-Brain is NOT Using

### Currently Used
- Memory with lastMessages: 20
- ToolCallFilter processor
- TokenLimiter processor
- Working memory with schema
- Semantic recall

### Could Add

1. **PIIDetector** - Redact sensitive info from documents before storing
2. **ModerationProcessor** - Block harmful content
3. **Scorers** - Track answer quality over time
4. **SystemPromptScrubber** - Prevent prompt leakage in responses
5. **GraphRAG** - Better document retrieval for complex queries
6. **Workflows** - Multi-step document validation pipelines
7. **Model Fallbacks** - Auto-switch if Claude is overloaded
8. **Hooks** - Log scores to analytics

### Recommended Additions for Lucas

```typescript
// 1. Add PIIDetector to protect sensitive data
inputProcessors: [
  new PIIDetector({
    model: 'anthropic/claude-3-5-haiku-20241022',
    detectionTypes: ['credit-card', 'ssn', 'api-key'],
    strategy: 'redact',
  }),
],

// 2. Add scorers to track quality
scorers: {
  relevancy: createAnswerRelevancyScorer({ model: 'anthropic/claude-3-5-haiku-20241022' }),
},

// 3. Add model fallback
model: [
  { id: 'primary', model: 'anthropic/claude-sonnet-4-20250514', maxRetries: 2 },
  { id: 'fallback', model: 'anthropic/claude-3-5-haiku-20241022', maxRetries: 3 },
],
```

---

## 9. Memory Clearing (How to Delete User Data)

Based on source code analysis:

```typescript
// 1. Delete working memory (set to null/empty)
await memory.updateWorkingMemory({
  resourceId: 'phone-number',
  workingMemory: '',  // or null
});

// 2. Delete all threads for resource
const { threads } = await memory.listThreadsByResourceId({ resourceId: 'phone-number' });
for (const thread of threads) {
  await memory.deleteThread(thread.id);
}

// 3. Direct database delete (for complete wipe)
await store.db.none('DELETE FROM mastra_resources WHERE "resourceId" = $1', [resourceId]);
await store.db.none('DELETE FROM mastra_threads WHERE "resourceId" = $1', [resourceId]);
// Messages are deleted via cascade or separate query
```

---

## 10. Tables Created by Mastra

- `mastra_threads` - Conversation threads
- `mastra_messages` - Individual messages
- `mastra_resources` - Working memory per resource
- `memory_messages` - Vector embeddings for semantic recall
- `mastra_workflow_snapshot` - Workflow state
- `mastra_traces` - Telemetry/observability
- `mastra_evals` - Evaluation results
- `mastra_scorers` - Scorer results

---

*Generated: January 2026*
*Mastra Version: Latest from GitHub main branch*
