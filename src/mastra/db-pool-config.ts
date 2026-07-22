/**
 * Keep Brain's long-lived database pools below the Supabase session-pool limit.
 * Mastra uses milliseconds for idle timeouts, while postgres.js uses seconds.
 */
export const AGENT_DATABASE_POOL_OPTIONS = Object.freeze({
  max: 2,
  idleTimeoutMillis: 10_000,
});

export const TOOL_DATABASE_POOL_OPTIONS = Object.freeze({
  max: 1,
  idle_timeout: 10,
});
