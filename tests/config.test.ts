import { describe, expect, it } from "vitest";
import {
  DEMO_INVEST_BRANDING_DEFAULTS,
  assertMastraObservabilityTopology,
  assertDistinctMastraStorageUrls,
  config,
  conversationMemoryConfigFromEnvironment,
  demoMarketProviderFromEnvironment,
  internalDiagnosticsTokenFromEnvironment,
  lockedOpenAIEscalationModel,
  lockedOpenAIModel,
  OPENAI_ESCALATION_MODEL,
  OPENAI_MODEL,
  PUBLIC_BRANDING_DEFAULTS,
  productProfileFromEnvironment,
  publicBrandingFromEnvironment,
  releaseTargetFromEnvironment,
  V3_CONVERSATION_MEMORY_DEFAULTS
} from "../src/config.js";

describe("Public branding configuration", () => {
  it("provides fictional Demo Invest branding without claiming a real institution", () => {
    expect(publicBrandingFromEnvironment({})).toEqual(
      DEMO_INVEST_BRANDING_DEFAULTS
    );
    expect(config.publicBranding).toEqual(DEMO_INVEST_BRANDING_DEFAULTS);
  });

  it("enables the fictional Demo Invest pack by default and supports a no-pack generic profile", () => {
    expect(productProfileFromEnvironment({})).toBe("demo-invest");
    expect(productProfileFromEnvironment({
      ASSISTANT_PRODUCT_PROFILE: " generic "
    })).toBe("generic");
    expect(publicBrandingFromEnvironment({
      ASSISTANT_PRODUCT_PROFILE: "generic"
    })).toEqual(PUBLIC_BRANDING_DEFAULTS);
    expect(publicBrandingFromEnvironment({
      ASSISTANT_PRODUCT_PROFILE: "demo-invest"
    })).toEqual(DEMO_INVEST_BRANDING_DEFAULTS);
    expect(() => productProfileFromEnvironment({
      ASSISTANT_PRODUCT_PROFILE: "bank-specific"
    })).toThrow(
      "ASSISTANT_PRODUCT_PROFILE must be generic or demo-invest"
    );
  });

  it("accepts bounded Unicode labels without changing policy identifiers", () => {
    expect(publicBrandingFromEnvironment({
      ASSISTANT_PUBLIC_BRAND_NAME: "  Açıq İnvest Köməkçisi  ",
      ASSISTANT_PUBLIC_BRAND_MARK: "Aİ",
      ASSISTANT_PUBLIC_PRODUCT_NAME: "Example Invest"
    })).toEqual({
      name: "Açıq İnvest Köməkçisi",
      mark: "Aİ",
      productName: "Example Invest"
    });
  });

  it("rejects markup, control characters, and oversized labels", () => {
    expect(() => publicBrandingFromEnvironment({
      ASSISTANT_PUBLIC_BRAND_NAME: "<script>"
    })).toThrow("ASSISTANT_PUBLIC_BRAND_NAME");
    expect(() => publicBrandingFromEnvironment({
      ASSISTANT_PUBLIC_BRAND_MARK: `IA\u0000`
    })).toThrow("ASSISTANT_PUBLIC_BRAND_MARK");
    expect(() => publicBrandingFromEnvironment({
      ASSISTANT_PUBLIC_PRODUCT_NAME: "x".repeat(81)
    })).toThrow("ASSISTANT_PUBLIC_PRODUCT_NAME");
  });
});

describe("OpenAI model configuration", () => {
  it("uses gpt-4o by default and gpt-4.1 only for escalation", () => {
    expect(lockedOpenAIModel(undefined)).toBe("gpt-4o");
    expect(OPENAI_MODEL).toBe("gpt-4o");
    expect(lockedOpenAIEscalationModel(undefined)).toBe("gpt-4.1");
    expect(OPENAI_ESCALATION_MODEL).toBe("gpt-4.1");
  });

  it("accepts only the two reviewed tier assignments", () => {
    expect(lockedOpenAIModel(" gpt-4o ")).toBe("gpt-4o");
    expect(lockedOpenAIEscalationModel(" gpt-4.1 ")).toBe(
      "gpt-4.1"
    );
    expect(() => lockedOpenAIModel("gpt-5.6-terra")).toThrow(
      "OPENAI_MODEL is locked to gpt-4o"
    );
    expect(() => lockedOpenAIEscalationModel("gpt-4.1-mini")).toThrow(
      "OPENAI_ESCALATION_MODEL is locked to gpt-4.1"
    );
  });
});

describe("Assistant release-target configuration", () => {
  it("defaults to the declared internal pilot", () => {
    expect(releaseTargetFromEnvironment({})).toBe("internal-pilot");
    expect(config.assistantReleaseTarget).toBe("internal-pilot");
  });

  it("defaults production processes to the fail-closed customer target", () => {
    expect(releaseTargetFromEnvironment({ NODE_ENV: "production" })).toBe(
      "customer-production"
    );
  });

  it("accepts only an explicit bounded release target", () => {
    expect(
      releaseTargetFromEnvironment({
        ASSISTANT_RELEASE_TARGET: " customer-production "
      })
    ).toBe("customer-production");
    expect(() =>
      releaseTargetFromEnvironment({ ASSISTANT_RELEASE_TARGET: "production" })
    ).toThrow(
      "ASSISTANT_RELEASE_TARGET must be internal-pilot or customer-production"
    );
  });
});

describe("Public demo market-provider configuration", () => {
  it("defaults to the non-networking synthetic provider", () => {
    expect(demoMarketProviderFromEnvironment({})).toBe("synthetic-offline");
    expect(config.assistantDemoMarketProvider).toBe("synthetic-offline");
  });

  it("requires an explicit development-provider selection", () => {
    expect(demoMarketProviderFromEnvironment({
      ASSISTANT_DEMO_MARKET_PROVIDER: " yahoo-development "
    })).toBe("yahoo-development");
    expect(() => demoMarketProviderFromEnvironment({
      ASSISTANT_DEMO_MARKET_PROVIDER: "auto"
    })).toThrow(
      "ASSISTANT_DEMO_MARKET_PROVIDER must be synthetic-offline or yahoo-development"
    );
  });
});

describe("Internal diagnostics authentication", () => {
  it("keeps diagnostics disabled when no secret is configured", () => {
    expect(internalDiagnosticsTokenFromEnvironment(undefined)).toBeUndefined();
    expect(internalDiagnosticsTokenFromEnvironment("   ")).toBeUndefined();
  });

  it("accepts only a bounded URL-safe bearer secret", () => {
    const token = "diagnostics-test-token-1234567890_abcd";
    expect(internalDiagnosticsTokenFromEnvironment(` ${token} `)).toBe(token);
    expect(() => internalDiagnosticsTokenFromEnvironment("too-short")).toThrow(
      "ASSISTANT_INTERNAL_DIAGNOSTICS_TOKEN"
    );
    expect(() =>
      internalDiagnosticsTokenFromEnvironment(`${"x".repeat(32)} secret`)
    ).toThrow("ASSISTANT_INTERNAL_DIAGNOSTICS_TOKEN");
  });
});

describe("Mastra storage isolation", () => {
  it("uses a physically separate Studio database by default", () => {
    expect(config.mastraStudioStorageUrl).not.toBe(config.mastraStorageUrl);
    expect(config.mastraStudioStorageUrl).toContain(
      ".mastra-storage-studio-private-v3.db"
    );
  });

  it("fails closed when Studio and application storage URLs are identical", () => {
    expect(() =>
      assertDistinctMastraStorageUrls(
        "file:///data/shared.db",
        "file:///data/shared.db"
      )
    ).toThrow(
      "MASTRA_STUDIO_STORAGE_URL must be physically separate from MASTRA_STORAGE_URL"
    );
  });

  it("canonicalizes file URL aliases before comparing Studio storage", () => {
    expect(() =>
      assertDistinctMastraStorageUrls(
        "file:///tmp/invest-assistant-shared.db",
        "file:///tmp/../tmp/invest-assistant-shared.db"
      )
    ).toThrow(
      "MASTRA_STUDIO_STORAGE_URL must be physically separate from MASTRA_STORAGE_URL"
    );
  });

  it("uses one canonical application and Studio observability database", () => {
    expect(config.mastraObservabilityShared).toBe(true);
    expect(config.mastraStudioObservabilityPath).toBe(
      config.mastraObservabilityPath
    );
    expect(config.mastraObservabilityPath).toContain(
      ".mastra-observability-shared.duckdb"
    );
  });

  it("requires matching paths in shared observability mode", () => {
    expect(() =>
      assertMastraObservabilityTopology(
        "/tmp/invest-assistant-app.duckdb",
        "/tmp/invest-assistant-studio.duckdb",
        true
      )
    ).toThrow(
      "Shared observability requires MASTRA_STUDIO_OBSERVABILITY_PATH to match MASTRA_OBSERVABILITY_PATH"
    );
    expect(() =>
      assertMastraObservabilityTopology(
        "/tmp/invest-assistant-shared.duckdb",
        "/tmp/../tmp/invest-assistant-shared.duckdb",
        true
      )
    ).not.toThrow();
  });

  it("retains separate paths when shared observability is disabled", () => {
    expect(() =>
      assertMastraObservabilityTopology(
        "/tmp/invest-assistant-shared.duckdb",
        "/tmp/../tmp/invest-assistant-shared.duckdb",
        false
      )
    ).toThrow(
      "Non-shared observability requires physically separate application and Studio paths"
    );
  });
});

describe("V3 bounded conversation-memory configuration", () => {
  it("enables a five-minute, 10,000-entry, three-hop process-local pilot store by default", () => {
    expect(conversationMemoryConfigFromEnvironment({})).toEqual({
      enabled: true,
      ttlMs: 300_000,
      maxEntries: 10_000,
      maxHops: 3,
      mode: "process-local-bounded"
    });
    expect(V3_CONVERSATION_MEMORY_DEFAULTS).toEqual({
      enabled: true,
      ttlMs: 300_000,
      maxEntries: 10_000,
      maxHops: 3
    });
    expect(config).toMatchObject({
      assistantV3ConversationMemoryEnabled: true,
      assistantV3ConversationMemoryTtlMs: 300_000,
      assistantV3ConversationMemoryMaxEntries: 10_000,
      assistantV3ConversationMemoryMaxHops: 3,
      assistantV3ConversationMemoryMode: "process-local-bounded"
    });
  });

  it("supports bounded overrides and derives disabled mode from the feature flag", () => {
    expect(conversationMemoryConfigFromEnvironment({
      ASSISTANT_V3_CONVERSATION_MEMORY_ENABLED: "false",
      ASSISTANT_V3_CONVERSATION_MEMORY_TTL_MS: "120000",
      ASSISTANT_V3_CONVERSATION_MEMORY_MAX_ENTRIES: "2500",
      ASSISTANT_V3_CONVERSATION_MEMORY_MAX_HOPS: "2"
    })).toEqual({
      enabled: false,
      ttlMs: 120_000,
      maxEntries: 2_500,
      maxHops: 2,
      mode: "disabled"
    });
  });

  it("fails closed for ambiguous flags and invalid or unsafe numeric bounds", () => {
    expect(() => conversationMemoryConfigFromEnvironment({
      ASSISTANT_V3_CONVERSATION_MEMORY_ENABLED: "sometimes"
    })).toThrow("ASSISTANT_V3_CONVERSATION_MEMORY_ENABLED must be a boolean value");

    for (const [name, environment] of [
      ["ASSISTANT_V3_CONVERSATION_MEMORY_TTL_MS", {
        ASSISTANT_V3_CONVERSATION_MEMORY_TTL_MS: "300001"
      }],
      ["ASSISTANT_V3_CONVERSATION_MEMORY_MAX_ENTRIES", {
        ASSISTANT_V3_CONVERSATION_MEMORY_MAX_ENTRIES: "10001"
      }],
      ["ASSISTANT_V3_CONVERSATION_MEMORY_MAX_HOPS", {
        ASSISTANT_V3_CONVERSATION_MEMORY_MAX_HOPS: "4"
      }]
    ] as const) {
      expect(() => conversationMemoryConfigFromEnvironment(environment)).toThrow(name);
    }
  });
});
