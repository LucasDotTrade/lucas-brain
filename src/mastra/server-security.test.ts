import { describe, expect, it } from "vitest";

import { createBrainAuth, readBrainApiKey } from "./server-security";

describe("lucas-brain server security", () => {
  it("fails authentication closed when the service credential is absent", async () => {
    const auth = createBrainAuth(readBrainApiKey({}));

    await expect(auth.authenticateToken("anything")).resolves.toBeNull();
    expect(readBrainApiKey({ MASTRA_API_KEY: "   " })).toBeUndefined();
  });

  it("protects every Mastra API route and leaves only health public", () => {
    const auth = createBrainAuth("service-secret");

    expect(auth.protected[0]).toEqual(/^\/api(?:\/.*)?$/);
    expect(auth.public).toEqual(["/health"]);
  });

  it("trims the configured service credential", () => {
    expect(readBrainApiKey({ MASTRA_API_KEY: "  service-secret  " })).toBe(
      "service-secret",
    );
  });

  it("accepts only the exact service credential", async () => {
    const auth = createBrainAuth("service-secret");

    await expect(auth.authenticateToken("service-secret")).resolves.toEqual({
      id: "lucas-core",
      role: "service",
    });
    await expect(auth.authenticateToken("")).resolves.toBeNull();
    await expect(auth.authenticateToken("service-secret-extra")).resolves.toBeNull();
    await expect(auth.authenticateToken("wrong-secret!")).resolves.toBeNull();
  });
});
