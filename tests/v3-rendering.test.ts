import { describe, expect, it } from "vitest";
import type { ClaimDraft } from "../src/assistant-v3/contracts.js";
import { EvidenceFactory } from "../src/assistant-v3/evidence.js";
import { decimal } from "../src/assistant-v3/fixed-decimal.js";
import {
  renderClaimDrafts,
  sealRenderableFact,
  type RenderableSemanticRole
} from "../src/assistant-v3/rendering.js";
import {
  constrainWriterClaimsToConversationShape,
  writerConversationIntent
} from "../src/assistant-v3/writers.js";
import {
  attachIntegrity,
  DevHmacSigner
} from "../src/assistant-v3/signing.js";

const signer = new DevHmacSigner({ keyId: "render", secret: "r".repeat(32) });
const evidence = new EvidenceFactory({
  signer,
  now: () => Date.parse("2026-07-22T08:00:00.000Z")
});
const tool = evidence.toolSuccess({
  requestId: "req",
  workflowRunId: "run",
  toolId: "read-market-snapshot",
  toolVersion: "1",
  arguments: { symbol: "AAPL" },
  result: { price: decimal("200") },
  source: {
    provider: "test",
    sourceId: "quote",
    sourceUrl: null,
    licenseClass: "synthetic",
    observedAt: "2026-07-22T08:00:00.000Z",
    sourceAsOf: "2026-07-22T08:00:00.000Z"
  }
});
const fact = evidence.fact({
  requestId: "req",
  workflowRunId: "run",
  kind: "market.price",
  subject: { type: "instrument", ref: "AAPL" },
  asOf: "2026-07-22T08:00:00.000Z",
  value: { price: decimal("200") },
  provenance: { toolExecutionIds: [tool.executionId], inputFactIds: [], calculation: null }
});
const fallback: ClaimDraft[] = [{
  claimId: "fallback",
  locale: "en-US",
  textTemplate: "The current observed price is {{F1}}.",
  factRefs: ["F1"],
  citationRefs: [],
  limitations: []
}];

function renderable(input: {
  alias: string;
  fact?: typeof fact;
  meaning: string;
  required: boolean;
  display: string;
  semanticRoles?: readonly RenderableSemanticRole[];
  requiredCitationAlias?: string;
}) {
  return sealRenderableFact({
    alias: input.alias,
    fact: input.fact ?? fact,
    meaning: input.meaning,
    required: input.required,
    display: input.display,
    ...(input.requiredCitationAlias === undefined
      ? {}
      : { requiredCitationAlias: input.requiredCitationAlias }),
    ...(input.semanticRoles === undefined
      ? {}
      : { semanticRoles: input.semanticRoles })
  }, evidence);
}

describe("V3 deterministic renderer", () => {
  it("inserts exact values only from verified fact placeholders", () => {
    const result = renderClaimDrafts({
      drafts: [{ ...fallback[0]!, claimId: "writer" }],
      facts: [renderable({
        alias: "F1",
        meaning: "the verified current market price and observation date",
        required: true,
        display: "$200.00 as of July 22"
      })],
      citations: [],
      tools: [tool],
      evidence,
      fallback,
      locale: "en-US"
    });
    expect(result.message).toBe("The current observed price is $200.00 as of July 22.");
    expect(result.generationMode).toBe("writer");
    expect(result.usedFactAliases).toEqual(["F1"]);
    expect(result.usedFactIds).toEqual([fact.factId]);
  });

  it("does not duplicate terminal punctuation around a verified placeholder", () => {
    const result = renderClaimDrafts({
      drafts: [{
        ...fallback[0]!,
        claimId: "writer-punctuation",
        textTemplate: "{{F1}}."
      }],
      facts: [renderable({
        alias: "F1",
        meaning: "the verified current market price and observation date",
        required: true,
        display: "AAPL is $200.00 as of 2026-07-22T08:00:00.000Z."
      })],
      citations: [],
      tools: [tool],
      evidence,
      fallback,
      locale: "en-US"
    });
    expect(result.message).toBe("AAPL is $200.00 as of 2026-07-22T08:00:00.000Z.");
    expect(result.generationMode).toBe("writer");
  });

  it("does not leave a proposition terminator before its paired citation", () => {
    const result = renderClaimDrafts({
      drafts: [{
        claimId: "writer-education-citation",
        locale: "az-AZ",
        textTemplate: "TWR üçün əsas məqam: {{F1}}; {{C1}}",
        factRefs: ["F1"],
        citationRefs: ["C1"],
        limitations: []
      }],
      facts: [renderable({
        alias: "F1",
        meaning: "the exact approved financial-education proposition",
        required: true,
        display:
          "TWR portfeldə bir vahidin mürəkkəb artım tempini ölçür.",
        semanticRoles: ["knowledge.education"],
        requiredCitationAlias: "C1"
      })],
      citations: [{
        alias: "C1",
        required: true,
        citation: {
          citationId: "education-citation",
          sourceId: "reviewed-education@v1",
          title: "Reviewed education",
          url: "https://www.govinfo.gov/example",
          sourceAsOf: "2026-07-22T08:00:00.000Z",
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          effectiveTo: null,
          contentHash: "a".repeat(64)
        }
      }],
      tools: [tool],
      evidence,
      fallback: [],
      locale: "az-AZ"
    });

    expect(result.message).toBe(
      "TWR üçün əsas məqam: TWR portfeldə bir vahidin mürəkkəb artım tempini ölçür; [1]"
    );
    expect(result.message).not.toContain(".;");
    expect(result.generationMode).toBe("writer");
  });

  it("rejects a writer-authored number and uses the deterministic fallback", () => {
    const result = renderClaimDrafts({
      drafts: [{
        ...fallback[0]!,
        claimId: "bad-writer",
        textTemplate: "The current price is 999 dollars and {{F1}}."
      }],
      facts: [renderable({
        alias: "F1",
        meaning: "the verified current market price",
        required: true,
        display: "$200.00"
      })],
      citations: [],
      tools: [tool],
      evidence,
      fallback,
      locale: "en-US"
    });
    expect(result.message).toBe("The current observed price is $200.00.");
    expect(result.generationMode).toBe("deterministic-fallback");
  });

  it("rejects a fact whose signed payload was tampered with", () => {
    const tampered = { ...fact, value: { price: decimal("999") } };
    expect(() => renderClaimDrafts({
      drafts: fallback,
      facts: [renderable({
        alias: "F1",
        fact: tampered,
        meaning: "the verified current market price",
        required: true,
        display: "$999.00"
      })],
      citations: [],
      tools: [tool],
      evidence,
      fallback,
      locale: "en-US"
    })).toThrow(/grounding gate/u);
  });

  it("supports granular aliases backed by one fact and deduplicates claim lineage", () => {
    const result = renderClaimDrafts({
      drafts: [{
        claimId: "granular-writer",
        locale: "en-US",
        textTemplate: "It is {{PRICE}}, observed {{AS_OF}}.",
        factRefs: ["PRICE", "AS_OF"],
        citationRefs: [],
        limitations: []
      }],
      facts: [
        renderable({
          alias: "PRICE",
          meaning: "the verified current market price",
          required: true,
          display: "$200.00"
        }),
        renderable({
          alias: "AS_OF",
          meaning: "the verified market observation date",
          required: false,
          display: "on July 22"
        })
      ],
      citations: [],
      tools: [tool],
      evidence,
      fallback,
      locale: "en-US"
    });

    expect(result.message).toBe("It is $200.00, observed on July 22.");
    expect(result.usedFactAliases).toEqual(["PRICE", "AS_OF"]);
    expect(result.usedFactIds).toEqual([fact.factId]);
    expect(result.claims[0]?.factRefs).toEqual([fact.factId]);
  });

  it("rejects a fluent shell that swaps the semantic roles of signed slots", () => {
    const roleFallback: ClaimDraft[] = [{
      claimId: "role-fallback",
      locale: "en-US",
      textTemplate: "Observed values: {{PRICE}} and {{CHANGE}}.",
      factRefs: ["PRICE", "CHANGE"],
      citationRefs: [],
      limitations: []
    }];
    const result = renderClaimDrafts({
      drafts: [{
        claimId: "role-inversion",
        locale: "en-US",
        textTemplate:
          "The change is {{PRICE}}, while the price is {{CHANGE}}.",
        factRefs: ["PRICE", "CHANGE"],
        citationRefs: [],
        limitations: []
      }],
      facts: [
        renderable({
          alias: "PRICE",
          meaning: "the latest verified market price",
          required: true,
          display: "$200.00"
        }),
        renderable({
          alias: "CHANGE",
          meaning: "the verified change versus the previous close",
          required: true,
          display: "higher"
        })
      ],
      citations: [],
      tools: [tool],
      evidence,
      fallback: roleFallback,
      locale: "en-US"
    });

    expect(result.generationMode).toBe("deterministic-fallback");
    expect(result.message).toBe("Observed values: $200.00 and higher.");

    for (const textTemplate of [
      "The price is {{CHANGE}}.",
      "The latest close is {{CHANGE}}.",
      "The current quote is {{CHANGE}}.",
      "The close is {{CHANGE}}.",
      "It trades at {{CHANGE}}."
    ]) {
      const singleRole = renderClaimDrafts({
        drafts: [{
          claimId: `single-role-${textTemplate.length}`,
          locale: "en-US",
          textTemplate,
          factRefs: ["CHANGE"],
          citationRefs: [],
          limitations: []
        }],
        facts: [renderable({
          alias: "CHANGE",
          meaning: "the verified change versus the previous close",
          required: true,
          display: "higher"
        })],
        citations: [],
        tools: [tool],
        evidence,
        fallback: [{
          claimId: "single-role-fallback",
          locale: "en-US",
          textTemplate: "Observed change: {{CHANGE}}.",
          factRefs: ["CHANGE"],
          citationRefs: [],
          limitations: []
        }],
        locale: "en-US"
      });
      expect(singleRole.generationMode, textTemplate)
        .toBe("deterministic-fallback");
    }

    for (const [textTemplate, meaning, display] of [
      [
        "The P/E ratio is {{VALUE}}.",
        "the verified market capitalization",
        "$5.00T"
      ],
      [
        "The portfolio return is {{VALUE}}.",
        "the verified portfolio cash balance",
        "$3,200.00"
      ]
    ] as const) {
      const guarded = renderClaimDrafts({
        drafts: [{
          claimId: `cross-role-${textTemplate.length}`,
          locale: "en-US",
          textTemplate,
          factRefs: ["VALUE"],
          citationRefs: [],
          limitations: []
        }],
        facts: [renderable({
          alias: "VALUE",
          meaning,
          required: true,
          display
        })],
        citations: [],
        tools: [tool],
        evidence,
        fallback: [{
          claimId: "cross-role-fallback",
          locale: "en-US",
          textTemplate: "Observed value: {{VALUE}}.",
          factRefs: ["VALUE"],
          citationRefs: [],
          limitations: []
        }],
        locale: "en-US"
      });
      expect(guarded.generationMode, textTemplate)
        .toBe("deterministic-fallback");
    }

    for (const [alias, textTemplate, meaning, display] of [
      [
        "IDENTITY",
        "This bond is {{IDENTITY}}.",
        "the verified instrument identity",
        "NVIDIA Corporation (NVDA)"
      ],
      [
        "DIVIDEND_YIELD",
        "The dividend is {{DIVIDEND_YIELD}}.",
        "the verified dividend yield",
        "0.03%"
      ],
      [
        "TRAILING_PE",
        "Earnings are {{TRAILING_PE}}.",
        "the verified trailing price-to-earnings ratio",
        "42.5"
      ],
      [
        "CASH_VALUE",
        "The holding is {{CASH_VALUE}}.",
        "the verified portfolio cash balance",
        "$3,200.00"
      ]
    ] as const) {
      const guarded = renderClaimDrafts({
        drafts: [{
          claimId: `role-inversion-${alias}`,
          locale: "en-US",
          textTemplate,
          factRefs: [alias],
          citationRefs: [],
          limitations: []
        }],
        facts: [renderable({
          alias,
          meaning,
          required: true,
          display
        })],
        citations: [],
        tools: [tool],
        evidence,
        fallback: [{
          claimId: `role-inversion-fallback-${alias}`,
          locale: "en-US",
          textTemplate: `Observed value: {{${alias}}}.`,
          factRefs: [alias],
          citationRefs: [],
          limitations: []
        }],
        locale: "en-US"
      });
      expect(guarded.generationMode, textTemplate)
        .toBe("deterministic-fallback");
    }
  });

  it("binds Azerbaijani material labels to their adjacent signed roles", () => {
    const price = renderable({
      alias: "PRICE",
      meaning: "the latest verified market price",
      required: true,
      display: "$200.00"
    });
    const change = renderable({
      alias: "CHANGE",
      meaning: "the verified change versus the previous close",
      required: true,
      display: "+2.50%"
    });
    const cash = renderable({
      alias: "CASH_VALUE",
      meaning: "the verified portfolio cash balance",
      required: true,
      display: "$3,200.00"
    });

    for (const attempt of [
      {
        id: "az-price-change-swap",
        template: "Dəyişiklik {{PRICE}}, qiymət isə {{CHANGE}}.",
        facts: [price, change],
        refs: ["PRICE", "CHANGE"]
      },
      {
        id: "az-change-as-price",
        template: "Cari qiymət {{CHANGE}}.",
        facts: [change],
        refs: ["CHANGE"]
      },
      {
        id: "az-cash-as-return",
        template: "Portfel gəliri {{CASH_VALUE}}.",
        facts: [cash],
        refs: ["CASH_VALUE"]
      }
    ] as const) {
      const result = renderClaimDrafts({
        drafts: [{
          claimId: attempt.id,
          locale: "az-AZ",
          textTemplate: attempt.template,
          factRefs: [...attempt.refs],
          citationRefs: [],
          limitations: []
        }],
        facts: [...attempt.facts],
        citations: [],
        tools: [tool],
        evidence,
        fallback: [{
          claimId: `${attempt.id}-fallback`,
          locale: "az-AZ",
          textTemplate: attempt.refs.map((alias) => `{{${alias}}}`).join(" "),
          factRefs: [...attempt.refs],
          citationRefs: [],
          limitations: []
        }],
        locale: "az-AZ"
      });
      expect(result.generationMode, attempt.template)
        .toBe("deterministic-fallback");
    }
  });

  it("preserves legitimate English and Azerbaijani role-bound writer prose", () => {
    const identity = renderable({
      alias: "IDENTITY",
      meaning: "the verified instrument identity",
      required: true,
      display: "NVIDIA Corporation (NVDA)"
    });
    const currency = renderable({
      alias: "CURRENCY",
      meaning: "the verified trading currency",
      required: true,
      display: "USD"
    });
    const price = renderable({
      alias: "PRICE",
      meaning: "the latest verified market price",
      required: true,
      display: "$200.00"
    });
    const change = renderable({
      alias: "CHANGE",
      meaning: "the verified change versus the previous close",
      required: true,
      display: "+2.50%"
    });

    const en = renderClaimDrafts({
      drafts: [{
        claimId: "legitimate-en-role-binding",
        locale: "en-US",
        textTemplate:
          "{{IDENTITY}} trades in {{CURRENCY}} and trades at {{PRICE}}.",
        factRefs: ["IDENTITY", "CURRENCY", "PRICE"],
        citationRefs: [],
        limitations: []
      }],
      facts: [identity, currency, price],
      citations: [],
      tools: [tool],
      evidence,
      fallback: fallback,
      locale: "en-US"
    });
    expect(en.generationMode).toBe("writer");

    const az = renderClaimDrafts({
      drafts: [{
        claimId: "legitimate-az-role-binding",
        locale: "az-AZ",
        textTemplate:
          "{{IDENTITY}} üçün cari qiymət {{PRICE}}-dır; əvvəlki bağlanışa qarşı dəyişiklik {{CHANGE}}.",
        factRefs: ["IDENTITY", "PRICE", "CHANGE"],
        citationRefs: [],
        limitations: []
      }],
      facts: [identity, price, change],
      citations: [],
      tools: [tool],
      evidence,
      fallback: [{
        claimId: "legitimate-az-fallback",
        locale: "az-AZ",
        textTemplate: "{{IDENTITY}} {{PRICE}} {{CHANGE}}.",
        factRefs: ["IDENTITY", "PRICE", "CHANGE"],
        citationRefs: [],
        limitations: []
      }],
      locale: "az-AZ"
    });
    expect(az.generationMode).toBe("writer");
  });

  it("binds the Azerbaijani distribution-yield compound to its signed role", () => {
    const distribution = renderable({
      alias: "DISTRIBUTION",
      meaning: "the verified distribution yield",
      required: true,
      display: "1,25%",
      semanticRoles: ["fundamental.dividend_yield"]
    });
    const distributionFallback: ClaimDraft[] = [{
      claimId: "distribution-yield-fallback",
      locale: "az-AZ",
      textTemplate: "{{DISTRIBUTION}}",
      factRefs: ["DISTRIBUTION"],
      citationRefs: [],
      limitations: []
    }];
    const draft: ClaimDraft = {
      claimId: "distribution-yield-writer",
      locale: "az-AZ",
      textTemplate: "paylanma gəlirliliyi: {{DISTRIBUTION}}",
      factRefs: ["DISTRIBUTION"],
      citationRefs: [],
      limitations: []
    };

    const accepted = renderClaimDrafts({
      drafts: [draft],
      facts: [distribution],
      citations: [],
      tools: [tool],
      evidence,
      fallback: distributionFallback,
      locale: "az-AZ"
    });
    expect(accepted).toMatchObject({
      generationMode: "writer",
      message: "paylanma gəlirliliyi: 1,25%"
    });

    const rejected = renderClaimDrafts({
      drafts: [draft],
      facts: [renderable({
        alias: "DISTRIBUTION",
        meaning: "the verified portfolio allocation",
        required: true,
        display: "1,25%",
        semanticRoles: ["portfolio.allocation"]
      })],
      citations: [],
      tools: [tool],
      evidence,
      fallback: distributionFallback,
      locale: "az-AZ"
    });
    expect(rejected.generationMode).toBe("deterministic-fallback");
  });

  it("accepts a value-free Azerbaijani history explanation generated from semantic slots", () => {
    const rejectionReasons: string[] = [];
    const historyFacts = [
      renderable({
        alias: "F1_IDENTITY",
        meaning: "the verified instrument identity",
        required: true,
        display: "Apple Inc. (AAPL)",
        semanticRoles: ["instrument.identity"]
      }),
      renderable({
        alias: "F1_RANGE",
        meaning: "the verified requested history range",
        required: true,
        display: "10 il",
        semanticRoles: ["source.time"]
      }),
      renderable({
        alias: "F1_START",
        meaning: "the verified first close in the requested range",
        required: true,
        display: "$25.00",
        semanticRoles: ["market.close"]
      }),
      renderable({
        alias: "F1_END",
        meaning: "the verified last close in the requested range",
        required: true,
        display: "$200.00",
        semanticRoles: ["market.close"]
      }),
      renderable({
        alias: "F1_RETURN",
        meaning: "the verified close-to-close return over the requested range",
        required: true,
        display: "+700.00%",
        semanticRoles: ["market.change"]
      }),
      renderable({
        alias: "F1_SOURCE",
        meaning: "the verified market history source and observation time",
        required: true,
        display: "test source as of July 22",
        semanticRoles: ["source.identity", "source.time"]
      })
    ];
    const historyFallback: ClaimDraft[] = [{
      claimId: "history-fallback",
      locale: "az-AZ",
      textTemplate:
        "{{F1_IDENTITY}} {{F1_RANGE}} {{F1_START}} {{F1_END}} {{F1_RETURN}} {{F1_SOURCE}}",
      factRefs: historyFacts.map(({ alias }) => alias),
      citationRefs: [],
      limitations: []
    }];
    const result = renderClaimDrafts({
      drafts: [{
        claimId: "history-writer",
        locale: "az-AZ",
        textTemplate:
          "{{F1_IDENTITY}} üçün son {{F1_RANGE}} qiymət tarixçəsində ilk bağlanış {{F1_START}}, son bağlanış {{F1_END}}, dövr üzrə dəyişiklik isə {{F1_RETURN}} olub. Məlumat mənbəyi: {{F1_SOURCE}}.",
        factRefs: historyFacts.map(({ alias }) => alias),
        citationRefs: [],
        limitations: []
      }],
      facts: historyFacts,
      citations: [],
      tools: [tool],
      evidence,
      fallback: historyFallback,
      locale: "az-AZ",
      onWriterRejected: (reason) => rejectionReasons.push(reason)
    });

    expect(result.generationMode, rejectionReasons.join(",")).toBe("writer");
  });

  it("accepts the constrained bilingual market-comparison claim shapes", () => {
    const facts = [
      renderable({
        alias: "F1_IDENTITY",
        meaning: "the verified instrument identity",
        required: true,
        display: "NVIDIA Corporation (NVDA)"
      }),
      renderable({
        alias: "F1_QUOTE",
        meaning: "the verified current price and previous-close change",
        required: true,
        display: "$200.00 (+2.50%)"
      }),
      renderable({
        alias: "F1_MARKET_CAP",
        meaning: "the verified market capitalization",
        required: true,
        display: "$5.00T"
      }),
      renderable({
        alias: "F1_TRAILING_PE",
        meaning: "the verified trailing price-to-earnings ratio",
        required: true,
        display: "42.50"
      }),
      renderable({
        alias: "F1_SOURCE",
        meaning: "the verified research time and source",
        required: true,
        display: "Yahoo Finance as of July 22"
      })
    ];
    const shared = {
      facts,
      citations: [],
      tools: [tool],
      evidence
    };

    const en = renderClaimDrafts({
      ...shared,
      drafts: [{
        claimId: "comparison-shape-en",
        locale: "en-US",
        textTemplate:
          "{{F1_IDENTITY}} — quote: {{F1_QUOTE}}; market cap: {{F1_MARKET_CAP}}; trailing P/E: {{F1_TRAILING_PE}}; {{F1_SOURCE}}",
        factRefs: facts.map(({ alias }) => alias),
        citationRefs: [],
        limitations: []
      }],
      fallback: [{
        claimId: "comparison-fallback-en",
        locale: "en-US",
        textTemplate:
          "{{F1_IDENTITY}} {{F1_QUOTE}} {{F1_MARKET_CAP}} {{F1_TRAILING_PE}} {{F1_SOURCE}}",
        factRefs: facts.map(({ alias }) => alias),
        citationRefs: [],
        limitations: []
      }],
      locale: "en-US"
    });
    expect(en.generationMode).toBe("writer");

    const az = renderClaimDrafts({
      ...shared,
      drafts: [{
        claimId: "comparison-shape-az",
        locale: "az-AZ",
        textTemplate:
          "{{F1_IDENTITY}} — kotirovka: {{F1_QUOTE}}; bazar kapitallaşması: {{F1_MARKET_CAP}}; P/E: {{F1_TRAILING_PE}}; {{F1_SOURCE}}",
        factRefs: facts.map(({ alias }) => alias),
        citationRefs: [],
        limitations: []
      }],
      fallback: [{
        claimId: "comparison-fallback-az",
        locale: "az-AZ",
        textTemplate:
          "{{F1_IDENTITY}} {{F1_QUOTE}} {{F1_MARKET_CAP}} {{F1_TRAILING_PE}} {{F1_SOURCE}}",
        factRefs: facts.map(({ alias }) => alias),
        citationRefs: [],
        limitations: []
      }],
      locale: "az-AZ"
    });
    expect(az.generationMode).toBe("writer");
  });

  it("accepts a bounded Azerbaijani market-move explanation shape", () => {
    const facts = [
      renderable({
        alias: "IDENTITY",
        meaning: "verified instrument identity",
        required: true,
        display: "NVIDIA Corporation (NVDA)",
        semanticRoles: ["instrument.identity"]
      }),
      renderable({
        alias: "MOVE",
        meaning: "verified current price and previous-close move",
        required: true,
        display: "qiymət $196,51; dəyişiklik −4,99%",
        semanticRoles: ["market.price", "market.change"]
      }),
      renderable({
        alias: "INTRADAY",
        meaning: "verified one-day first-to-last close movement",
        required: true,
        display: "ilk bağlanış $205,73; son bağlanış $196,51",
        semanticRoles: ["market.close", "market.change", "source.time"]
      }),
      renderable({
        alias: "CONTEXT",
        meaning: "latest attributable headlines offered only as possible context",
        required: true,
        display: "“Nvidia Slides as AI Spending Fears Hit Chip Stocks”",
        semanticRoles: ["market.context"]
      }),
      renderable({
        alias: "CAUSALITY",
        meaning: "required limitation that the evidence does not establish causality",
        required: true,
        display: "səbəb əlaqəsi bu mənbələrlə müəyyən edilməyib",
        semanticRoles: ["source.limitation"]
      }),
      renderable({
        alias: "SOURCE",
        meaning: "verified observation times for quote, history, and content",
        required: true,
        display: "mənbə: Yahoo Finance",
        semanticRoles: ["source.identity", "source.time", "source.freshness"]
      })
    ];
    const draft: ClaimDraft = {
      claimId: "market-move-writer",
      locale: "az-AZ",
      textTemplate:
        "{{IDENTITY}} üçün kotirovka: {{MOVE}}. Bağlanış: {{INTRADAY}}. Mümkün kontekst: {{CONTEXT}}. Sübut məhdudiyyəti: {{CAUSALITY}}. {{SOURCE}}",
      factRefs: facts.map(({ alias }) => alias),
      citationRefs: [],
      limitations: []
    };
    const rejectionReasons: string[] = [];
    const result = renderClaimDrafts({
      drafts: [draft],
      facts,
      citations: [],
      tools: [tool],
      evidence,
      fallback: [draft],
      locale: "az-AZ",
      onWriterRejected: (reason) => rejectionReasons.push(reason)
    });

    expect(result.generationMode, rejectionReasons.join(",")).toBe("writer");
    expect(result.message).toContain("Mümkün kontekst:");
    expect(result.message).toContain("Sübut məhdudiyyəti:");
  });

  it("compacts the exact two-ETF model draft before the unchanged conversation-shape gate", () => {
    const exactDraft = (prefix: "F1" | "F2"): ClaimDraft => {
      const factRefs = [
        `${prefix}_IDENTITY`,
        `${prefix}_CLASSIFICATION`,
        `${prefix}_EXPENSE`,
        `${prefix}_DISTRIBUTION`,
        `${prefix}_HISTORICAL_RISK`,
        `${prefix}_RATE_RISK`,
        `${prefix}_CONCENTRATION`,
        `${prefix}_SOURCE`
      ];
      return {
        claimId: `exact-etf-comparison-${prefix}`,
        locale: "az-AZ",
        textTemplate:
          `{{${prefix}_IDENTITY}} üçün {{${prefix}_CLASSIFICATION}}. Xidmət haqqı: {{${prefix}_EXPENSE}}; paylanma gəlirliliyi: {{${prefix}_DISTRIBUTION}}. Risk: {{${prefix}_HISTORICAL_RISK}}; risk: {{${prefix}_RATE_RISK}}; konsentrasiya: {{${prefix}_CONCENTRATION}}. {{${prefix}_SOURCE}}`,
        factRefs,
        citationRefs: [],
        limitations: []
      };
    };
    const specs: ReadonlyArray<{
      suffix: string;
      meaning: string;
      semanticRoles: readonly RenderableSemanticRole[];
      displays: readonly [string, string];
    }> = [
      {
        suffix: "IDENTITY",
        meaning: "verified ETF name and ticker",
        semanticRoles: ["instrument.identity"],
        displays: [
          "Vanguard S&P 500 ETF (VOO)",
          "Invesco QQQ Trust (QQQ)"
        ]
      },
      {
        suffix: "CLASSIFICATION",
        meaning: "verified ETF classification and fund family",
        semanticRoles: ["instrument.type"],
        displays: [
          "ETF-dir; kateqoriya: Large Blend; fond ailəsi: Vanguard",
          "ETF-dir; kateqoriya: Large Growth; fond ailəsi: Invesco"
        ]
      },
      {
        suffix: "EXPENSE",
        meaning: "verified annual expense ratio",
        semanticRoles: ["knowledge.fee"],
        displays: ["0,03%", "0,18%"]
      },
      {
        suffix: "DISTRIBUTION",
        meaning: "verified distribution yield",
        semanticRoles: ["fundamental.dividend_yield"],
        displays: ["1,07%", "0,41%"]
      },
      {
        suffix: "HISTORICAL_RISK",
        meaning: "verified historical volatility and drawdown risk",
        semanticRoles: ["risk.generic", "risk.volatility", "risk.drawdown"],
        displays: [
          "1 illik volatillik 12,72%, maksimum eniş 9,19%",
          "1 illik volatillik 19,05%, maksimum eniş 12,19%"
        ]
      },
      {
        suffix: "RATE_RISK",
        meaning: "verified duration and maturity indicators for rate risk",
        semanticRoles: ["risk.generic", "risk.duration", "risk.maturity"],
        displays: [
          "müddət mövcud deyil, orta ödəmə müddəti mövcud deyil",
          "müddət mövcud deyil, orta ödəmə müddəti mövcud deyil"
        ]
      },
      {
        suffix: "CONCENTRATION",
        meaning: "verified holdings concentration",
        semanticRoles: ["risk.concentration"],
        displays: [
          "ən böyük mövqe 7,50%, ilk on mövqe 36,33%",
          "ən böyük mövqe 7,58%, ilk on mövqe 44,92%"
        ]
      },
      {
        suffix: "SOURCE",
        meaning: "verified ETF research time and source",
        semanticRoles: ["source.identity", "source.time"],
        displays: [
          "VOO məlumatı 2026-07-28T11:41:33.506Z tarixinədir; mənbə: Yahoo Finance.",
          "QQQ məlumatı 2026-07-28T11:41:34.926Z tarixinədir; mənbə: Yahoo Finance."
        ]
      }
    ];
    const facts = (["F1", "F2"] as const).flatMap((prefix, index) =>
      specs.map((spec) => renderable({
        alias: `${prefix}_${spec.suffix}`,
        meaning: spec.meaning,
        required: true,
        display: spec.displays[index]!,
        semanticRoles: spec.semanticRoles
      }))
    );
    const original = (["F1", "F2"] as const).map(exactDraft);
    const constrained = constrainWriterClaimsToConversationShape(
      original,
      writerConversationIntent(
        "VOO ilə QQQ arasında əsas fərq nədir?",
        "az-AZ"
      )
    );
    const rejectionReasons: string[] = [];

    const before = renderClaimDrafts({
      drafts: original,
      facts,
      citations: [],
      tools: [tool],
      evidence,
      fallback: constrained,
      locale: "az-AZ",
      onWriterRejected: (reason) => rejectionReasons.push(reason)
    });
    expect(before.generationMode).toBe("deterministic-fallback");
    expect(rejectionReasons).toEqual(["conversation_shape"]);

    const after = renderClaimDrafts({
      drafts: constrained,
      facts,
      citations: [],
      tools: [tool],
      evidence,
      fallback: constrained,
      locale: "az-AZ"
    });
    const sentences = after.message
      .replace(/([\p{N}])\.(?=[\p{N}])/gu, "$1")
      .split(/[.!?]+/gu)
      .map((part) => part.trim())
      .filter(Boolean);
    expect(after.generationMode).toBe("writer");
    expect(after.message).toContain("Vanguard S&P 500 ETF (VOO)");
    expect(after.message).toContain("Invesco QQQ Trust (QQQ)");
    expect(after.message.length).toBeLessThanOrEqual(900);
    expect(sentences.length).toBeLessThanOrEqual(5);
  });

  it("rejects unsupported conclusions, duplicate claim ids, and model limitations", () => {
    const facts = [renderable({
      alias: "F1",
      meaning: "the verified current market price",
      required: true,
      display: "$200.00"
    })];
    const attempts: ClaimDraft[][] = [
      [{
        ...fallback[0]!,
        claimId: "unsupported-conclusion",
        textTemplate: "NVDA is undervalued and likely to rise. {{F1}}."
      }],
      [{
        ...fallback[0]!,
        claimId: "spelled-out-number",
        textTemplate: "The price is two hundred dollars. {{F1}}."
      }],
      [{
        ...fallback[0]!,
        claimId: "unsupported-bankruptcy",
        textTemplate: "It faces bankruptcy. {{F1}}."
      }],
      [{
        ...fallback[0]!,
        claimId: "unicode-number",
        textTemplate: "The value is ١١ dollars. {{F1}}."
      }],
      [{
        ...fallback[0]!,
        claimId: "fullwidth-number",
        textTemplate: "The value is ９９９ dollars. {{F1}}."
      }],
      [{
        ...fallback[0]!,
        claimId: "wrong-english-locale",
        textTemplate: "Actualmente cotiza a {{F1}}."
      }],
      [
        { ...fallback[0]!, claimId: "duplicate" },
        { ...fallback[0]!, claimId: "duplicate" }
      ],
      [{
        ...fallback[0]!,
        claimId: "malicious-limitation",
        limitations: ["AAPL is $999 and should be bought."]
      }]
    ];

    for (const drafts of attempts) {
      const result = renderClaimDrafts({
        drafts,
        facts,
        citations: [],
        tools: [tool],
        evidence,
        fallback,
        locale: "en-US"
      });
      expect(result.generationMode).toBe("deterministic-fallback");
      expect(result.claims.every(({ limitations }) => limitations.length === 0)).toBe(true);
    }
  });

  it("rejects a projection whose signed display was changed", () => {
    const sealed = renderable({
      alias: "F1",
      meaning: "the verified current market price",
      required: true,
      display: "$200.00"
    });
    expect(() => renderClaimDrafts({
      drafts: fallback,
      facts: [{ ...sealed, display: "$999.00" }],
      citations: [],
      tools: [tool],
      evidence,
      fallback,
      locale: "en-US"
    })).toThrow(/grounding gate/u);
  });

  it("binds a projection to the complete signed parent fact, not only its id", () => {
    const sealed = renderable({
      alias: "F1",
      meaning: "the verified current market price",
      required: true,
      display: "$200.00"
    });
    const { integrity: _oldIntegrity, ...factPayload } = fact;
    const replacementFact = attachIntegrity({
      ...factPayload,
      value: { price: decimal("201") }
    }, signer);

    expect(() => renderClaimDrafts({
      drafts: fallback,
      facts: [{ ...sealed, fact: replacementFact }],
      citations: [],
      tools: [tool],
      evidence,
      fallback,
      locale: "en-US"
    })).toThrow(/grounding gate/u);
  });

  it("falls back when the model writes in the wrong language", () => {
    const azFallback: ClaimDraft[] = [{
      claimId: "az-fallback",
      locale: "az-AZ",
      textTemplate: "Cari qiymət {{F1}}.",
      factRefs: ["F1"],
      citationRefs: [],
      limitations: []
    }];
    const result = renderClaimDrafts({
      drafts: [{
        claimId: "wrong-language",
        locale: "az-AZ",
        textTemplate: "The current price is {{F1}}.",
        factRefs: ["F1"],
        citationRefs: [],
        limitations: []
      }],
      facts: [renderable({
        alias: "F1",
        meaning: "the verified current market price",
        required: true,
        display: "$200.00"
      })],
      citations: [],
      tools: [tool],
      evidence,
      fallback: azFallback,
      locale: "az-AZ"
    });
    expect(result.generationMode).toBe("deterministic-fallback");
    expect(result.message).toBe("Cari qiymət $200.00.");

    for (const textTemplate of [
      "Şirkət bankrot olacaq, {{F1}}.",
      "Esto üçün {{F1}}.",
      "Bu {{F1}} səbəbindən şirkət bağlanacaq."
    ]) {
      const guarded = renderClaimDrafts({
        drafts: [{
          claimId: `guarded-${textTemplate.length}`,
          locale: "az-AZ",
          textTemplate,
          factRefs: ["F1"],
          citationRefs: [],
          limitations: []
        }],
        facts: [renderable({
          alias: "F1",
          meaning: "the verified current market price",
          required: true,
          display: "$200.00"
        })],
        citations: [],
        tools: [tool],
        evidence,
        fallback: azFallback,
        locale: "az-AZ"
      });
      expect(guarded.generationMode, textTemplate).toBe("deterministic-fallback");
    }
  });
});
