import { timingSafeEqual } from "node:crypto";

export type BrainServicePrincipal = {
  id: "lucas-core";
  role: "service";
};

const BRAIN_SERVICE_PRINCIPAL: BrainServicePrincipal = {
  id: "lucas-core",
  role: "service",
};

function tokensMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);

  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function readBrainApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.MASTRA_API_KEY?.trim() || undefined;
}

export function createBrainAuth(expectedToken: string | undefined) {
  return {
    // Protect the complete framework API surface, including `/api` itself.
    // If the deployment secret is absent, authentication deliberately fails
    // closed while `/health` remains available for rollout recovery.
    protected: [/^\/api(?:\/.*)?$/],
    public: ["/health"],
    authenticateToken: async (
      token: string,
    ): Promise<BrainServicePrincipal | null> =>
      expectedToken && tokensMatch(token, expectedToken)
        ? BRAIN_SERVICE_PRINCIPAL
        : null,
    authorize: async () => true,
  };
}
