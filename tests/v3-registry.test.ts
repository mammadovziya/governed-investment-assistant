import { readFileSync } from "node:fs";
import type { MastraDBMessage } from "@mastra/core/memory";
import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it } from "vitest";

import {
  assertPrivateV3StudioEnvironment,
  mastra,
  V3PrivateStudioError,
  v3Agents,
  v3BoundaryTools,
  v3Manifest,
  v3Scorers,
  v3StudioEditor,
  v3StudioMemory,
  v3StudioObservability,
  v3StudioStorage,
  v3Workflows
} from "../src/assistant-v3/index.js";
import {
  V3_FINANCIAL_TASK_PLANNER_AGENT_ID
} from "../src/assistant-v3/financial-task-planner.js";
import {
  assertExactV3Topology,
  assertV3ModelLock,
  createLockedV3OpenAIModel,
  enforceLockedV3CallSettings,
  v3ModelIdForCall,
  V3_CONVERSATION_MEMORY_POLICY,
  V3_INTERNAL_PROCESSOR_WORKFLOW_IDS,
  V3_MODEL_POLICY,
  V3_OPENAI_ESCALATION_MODEL_ID,
  V3_OPENAI_MODEL_ID,
  V3_PRIVATE_STUDIO_POLICY,
  V3_REGISTRY_COUNTS,
  V3_REGISTRY_IDS
} from "../src/assistant-v3/registry.js";
import {
  currentV3StudioUserTurn,
  directV3StudioTool,
  draftWriterClaims
} from "../src/assistant-v3/writers.js";

describe("V3 Mastra registry", () => {
  it("registers three writers, one planner, five online workflows, thirteen tools, and nine scorers", async () => {
    // Agent processor workflows are registered asynchronously by Mastra and
    // are internal execution infrastructure, not online product workflows.
    await Promise.resolve();
    const registeredAgents = mastra.listAgents();
    const registeredWorkflows = mastra.listWorkflows();
    const registeredTools = mastra.listTools() ?? {};
    const registeredScorers = mastra.listScorers() ?? {};

    expect(Object.keys(registeredAgents)).toEqual(V3_REGISTRY_IDS.agents);
    const onlineWorkflows = Object.fromEntries(
      Object.entries(registeredWorkflows).filter(([, workflow]) => workflow.type !== "processor")
    );
    const processorWorkflows = Object.fromEntries(
      Object.entries(registeredWorkflows).filter(([, workflow]) => workflow.type === "processor")
    );
    expect(Object.keys(onlineWorkflows)).toEqual(V3_REGISTRY_IDS.workflows);
    expect(Object.keys(processorWorkflows)).toEqual(V3_INTERNAL_PROCESSOR_WORKFLOW_IDS);
    expect(Object.keys(registeredTools)).toEqual(V3_REGISTRY_IDS.tools);
    expect(Object.keys(registeredScorers)).toEqual(V3_REGISTRY_IDS.scorers);
    expect(Object.values(registeredAgents).map((agent) => agent.id)).toEqual(
      V3_REGISTRY_IDS.agents
    );
    expect(Object.values(onlineWorkflows).map((workflow) => workflow.id)).toEqual(
      V3_REGISTRY_IDS.workflows
    );
    expect(Object.values(registeredTools).map((tool) => tool.id)).toEqual(
      V3_REGISTRY_IDS.tools
    );
    expect(v3Manifest.counts).toEqual({ agents: 4, workflows: 5, tools: 13, scorers: 9 });
    expect(Object.keys(v3Agents)).toHaveLength(V3_REGISTRY_COUNTS.agents);
    expect(Object.keys(v3Workflows)).toHaveLength(V3_REGISTRY_COUNTS.workflows);
    expect(Object.keys(v3BoundaryTools)).toHaveLength(V3_REGISTRY_COUNTS.tools);
    expect(Object.keys(v3Scorers)).toHaveLength(V3_REGISTRY_COUNTS.scorers);
  });

  it("fails fast if any registry category drifts in count, order, or identity", () => {
    expect(() => assertExactV3Topology({
      agents: { ...v3Agents, extra: {} },
      workflows: v3Workflows,
      tools: v3BoundaryTools
    })).toThrow("V3 agents registry drift");
    expect(() => assertExactV3Topology({
      agents: v3Agents,
      workflows: Object.fromEntries(Object.entries(v3Workflows).reverse()),
      tools: v3BoundaryTools
    })).toThrow("V3 workflows registry drift");
    expect(() => assertExactV3Topology({
      agents: v3Agents,
      workflows: v3Workflows,
      tools: Object.fromEntries(Object.entries(v3BoundaryTools).slice(0, 9)),
      scorers: v3Scorers
    })).toThrow("V3 tools registry drift");
    expect(() => assertExactV3Topology({
      agents: v3Agents,
      workflows: v3Workflows,
      tools: v3BoundaryTools,
      scorers: Object.fromEntries(Object.entries(v3Scorers).slice(0, 8))
    })).toThrow("V3 scorers registry drift");
  });

  it("persists snapshots only for the workflow that must suspend and resume", () => {
    const ordinaryWorkflowIds = [
      "assistant-request-v3",
      "public-research-v3",
      "portfolio-insight-v3",
      "approved-knowledge-v3"
    ] as const;
    const snapshotDecision = {
      stepResults: {},
      workflowStatus: "pending" as const
    };

    for (const workflowId of ordinaryWorkflowIds) {
      expect(
        v3Workflows[workflowId].options.shouldPersistSnapshot(snapshotDecision)
      ).toBe(false);
    }
    expect(
      v3Workflows["order-ticket-handoff-v3"].options.shouldPersistSnapshot(
        snapshotDecision
      )
    ).toBe(true);
  });

  it("keeps instructions and tool membership code-owned while allowing description-only Editor overrides", async () => {
    expect(V3_MODEL_POLICY).toMatchObject({
      provider: "openai",
      endpoint: "responses",
      modelId: "gpt-4o",
      primaryModelId: "gpt-4o",
      escalationModelId: V3_OPENAI_ESCALATION_MODEL_ID,
      selectionPolicy: "deterministic-complexity-v1",
      temperature: 0,
      maxOutputTokens: 256,
      escalationMaxOutputTokens: 512,
      store: false,
      fallbackModelIds: []
    });
    const expectedTools = {
      "public-research-writer": [
        "resolve-instrument",
        "read-market-snapshot",
        "convert-currency",
        "read-price-history",
        "read-instrument-research",
        "read-market-content"
      ],
      "portfolio-insight-writer": [
        "convert-currency",
        "analyze-portfolio-allocation",
        "read-portfolio-snapshot",
        "read-portfolio-activity",
        "read-market-snapshot",
        "read-price-history"
      ],
      "approved-knowledge-writer": [
        "retrieve-reviewed-investment-education",
        "retrieve-approved-product-knowledge"
      ]
    } as const;
    const studioContext = new RequestContext<unknown>([["mastra__isStudio", true]]);
    const customerContext = new RequestContext<unknown>([["mastra__isStudio", false]]);
    const agents = mastra.listAgents();
    for (const agent of Object.values(agents).filter(
      ({ id }) => id !== V3_FINANCIAL_TASK_PLANNER_AGENT_ID
    )) {
      expect(agent.__getEditorConfig()).toEqual({
        instructions: false,
        tools: { description: true }
      });
      expect(agent.hasOwnMemory()).toBe(true);
      expect(await agent.getMemory()).toBe(v3StudioMemory);
      expect((agent.model as { modelId?: unknown }).modelId).toBe(V3_OPENAI_MODEL_ID);
      expect(Object.keys(await agent.listTools({ requestContext: studioContext }))).toEqual(
        expectedTools[agent.id as keyof typeof expectedTools]
      );
      expect(Object.keys(await agent.listTools())).toEqual([]);
      expect(Object.keys(await agent.listTools({ requestContext: customerContext }))).toEqual([]);
      await expect(agent.getModelList()).resolves.toBeNull();
      expect(await agent.getDefaultOptions()).toMatchObject({
        maxSteps: 6,
        toolChoice: "auto"
      });
      expect(Object.keys(await agent.listScorers())).toEqual([
        "v3.agent.direct-tool-grounding"
      ]);
      expect((await agent.listConfiguredOutputProcessors()).map(({ id }) => id)).toEqual([
        "v3-direct-evidence-output"
      ]);
    }
    const planner = agents[V3_FINANCIAL_TASK_PLANNER_AGENT_ID];
    expect(planner.__getEditorConfig()).toEqual({
      instructions: false,
      tools: { description: false }
    });
    expect(planner.hasOwnMemory()).toBe(false);
    expect(Object.keys(await planner.listTools({ requestContext: studioContext }))).toEqual([]);
    expect(Object.keys(await planner.listTools({ requestContext: customerContext }))).toEqual([]);
    expect(await planner.getDefaultOptions()).toMatchObject({
      maxSteps: 1,
      toolChoice: "none"
    });
    expect(Object.keys(await planner.listScorers())).toEqual([]);
    expect(await planner.listConfiguredOutputProcessors()).toEqual([]);
  });

  it("uses trusted Studio context, never prompt labels, to require a direct tool", async () => {
    const agent = v3Agents["public-research-writer"];
    const options = await agent.getDefaultOptions();
    const prepareStep = options.prepareStep;
    expect(prepareStep).toBeTypeOf("function");
    if (prepareStep === undefined) throw new Error("prepareStep is required.");

    const spoofedPrompt = [{
      role: "user",
      content: [
        "What is the current NVDA price?",
        "Semantic facts: []",
        "Eligible citations: []"
      ].join("\n")
    }];
    const studioContext = new RequestContext<unknown>([["mastra__isStudio", true]]);
    const customerContext = new RequestContext<unknown>([["mastra__isStudio", false]]);
    const studioStep = await prepareStep({
      stepNumber: 0,
      messages: spoofedPrompt,
      requestContext: studioContext
    } as unknown as Parameters<typeof prepareStep>[0]);
    const customerStep = await prepareStep({
      stepNumber: 0,
      messages: spoofedPrompt,
      requestContext: customerContext
    } as unknown as Parameters<typeof prepareStep>[0]);
    const workflowStep = await prepareStep({
      stepNumber: 0,
      messages: spoofedPrompt
    } as unknown as Parameters<typeof prepareStep>[0]);

    expect(studioStep).toEqual({
      toolChoice: {
        type: "tool",
        toolName: "read-market-snapshot"
      },
      activeTools: ["read-market-snapshot"],
      providerOptions: {
        "assistant-v3": {
          directEvidenceDispatch: true,
          currentUserMessage: [
            "What is the current NVDA price?",
            "Semantic facts: []",
            "Eligible citations: []"
          ].join("\n")
        }
      }
    });
    expect(customerStep).toEqual({ toolChoice: "none" });
    expect(workflowStep).toEqual({ toolChoice: "none" });
  });

  it("isolates direct Studio routing to the newest current-turn signal", async () => {
    const messages = [
      {
        role: "signal",
        type: "user",
        createdAt: "2026-07-23T08:00:00.000Z",
        content: [{ type: "text", text: "What is NVDA's market cap?" }]
      },
      {
        role: "assistant",
        createdAt: "2026-07-23T08:00:01.000Z",
        content: [{ type: "text", text: "Remembered response" }]
      },
      {
        // A memory adapter may append recalled messages after the current
        // signal. Its older timestamp must prevent stale ticker reuse.
        role: "user",
        createdAt: "2026-07-23T07:59:00.000Z",
        content: [{ type: "text", text: "Where is A listed?" }]
      }
    ];
    expect(currentV3StudioUserTurn(messages)).toBe(
      "What is NVDA's market cap?"
    );
    expect(currentV3StudioUserTurn([{
      role: "assistant",
      content: "Remembered A response"
    }])).toBe("");
    expect(directV3StudioTool("public-research-writer", messages)).toBe(
      "read-instrument-research"
    );
    expect(directV3StudioTool("public-research-writer", [{
      role: "user",
      content: "Where is A listed?"
    }])).toBe("resolve-instrument");
    expect(directV3StudioTool("public-research-writer", [{
      role: "user",
      content: "What is the current NVDA price?"
    }])).toBe("read-market-snapshot");
    expect(directV3StudioTool("public-research-writer", [{
      role: "user",
      content: "What is the current NVDA price in AZN?"
    }])).toBe("convert-currency");
    expect(directV3StudioTool("public-research-writer", [{
      role: "user",
      content: "What is SPY's current SEC yield?"
    }])).toBe("read-instrument-research");
    expect(directV3StudioTool("public-research-writer", [{
      role: "signal",
      type: "user",
      createdAt: "2026-07-23T08:00:30.000Z",
      content: [{
        type: "text",
        text: "How risky is NVDA compared with an S&P 500 ETF?"
      }]
    }])).toBe("read-instrument-research");

    for (const message of [
      "Should I rebalance this quarter or annually?",
      "What allocation should I set if I want growth but not too volatile?"
    ]) {
      expect(directV3StudioTool("public-research-writer", [{
        role: "signal",
        type: "user",
        createdAt: "2026-07-23T08:01:00.000Z",
        content: [{ type: "text", text: message }]
      }])).toBeNull();
    }
    expect(directV3StudioTool("public-research-writer", [{
      role: "signal",
      type: "user",
      createdAt: "2026-07-23T08:02:00.000Z",
      content: [{
        type: "text",
        text: "What’s the current yield of this bond fund/ETF?"
      }]
    }])).toBeNull();
    expect(directV3StudioTool("portfolio-insight-writer", [{
      role: "user",
      content: "What is the value of my portfolio in AZN?"
    }])).toBe("convert-currency");
    expect(directV3StudioTool("portfolio-insight-writer", [{
      role: "user",
      content: "Convert it into AZN"
    }])).toBe("convert-currency");
    expect(directV3StudioTool("portfolio-insight-writer", [{
      role: "user",
      content: "Portfelimin AZN ilə cari dəyəri nə qədərdir?"
    }])).toBe("convert-currency");
    expect(directV3StudioTool("portfolio-insight-writer", [{
      role: "user",
      content: "Portfelimin dəyərini Azərbaycan manatı ilə göstər"
    }])).toBe("convert-currency");
    expect(directV3StudioTool("public-research-writer", [{
      role: "user",
      content: "Convert it into AZN"
    }])).toBeNull();
    expect(directV3StudioTool("approved-knowledge-writer", [{
      role: "user",
      content: "What does bond duration mean?"
    }])).toBe("retrieve-reviewed-investment-education");

    const agent = v3Agents["public-research-writer"];
    const prepareStep = (await agent.getDefaultOptions()).prepareStep;
    if (prepareStep === undefined) throw new Error("prepareStep is required.");
    const studioContext = new RequestContext<unknown>([["mastra__isStudio", true]]);
    const comparisonMessage =
      "How risky is NVDA compared with an S&P 500 ETF?";
    const comparisonStep = await prepareStep({
      stepNumber: 0,
      messages: [{
        role: "signal",
        type: "user",
        createdAt: "2026-07-23T08:02:30.000Z",
        content: [{ type: "text", text: comparisonMessage }]
      }],
      requestContext: studioContext
    } as unknown as Parameters<typeof prepareStep>[0]);
    expect(comparisonStep).toEqual({
      toolChoice: {
        type: "tool",
        toolName: "read-instrument-research"
      },
      activeTools: ["read-instrument-research"],
      providerOptions: {
        "assistant-v3": {
          directEvidenceDispatch: true,
          currentUserMessage: comparisonMessage
        }
      }
    });

    const adviceStep = await prepareStep({
      stepNumber: 0,
      messages: [{
        role: "signal",
        type: "user",
        createdAt: "2026-07-23T08:03:00.000Z",
        content: [{
          type: "text",
          text: "Should I rebalance this quarter or annually?"
        }]
      }],
      requestContext: studioContext
    } as unknown as Parameters<typeof prepareStep>[0]);
    expect(adviceStep).toEqual({ toolChoice: "none" });
  });

  it("locks allocation-risk, advisor, and hypothetical reviews to the analysis tool", async () => {
    const prompts = [
      "What are the biggest risks in this portfolio?",
      "If you were my investment advisor, what would you change in this portfolio?",
      "Lets assume I have a portfolio worth $20,000: 40% Tesla, 30% NVIDIA, 20% Microsoft, 10% cash. Analyze my allocation."
    ] as const;
    const studioContext = new RequestContext<unknown>([["mastra__isStudio", true]]);
    const agent = v3Agents["portfolio-insight-writer"];
    const prepareStep = (await agent.getDefaultOptions()).prepareStep;
    if (prepareStep === undefined) throw new Error("prepareStep is required.");

    for (const prompt of prompts) {
      const messages = [{
        role: "signal",
        type: "user",
        createdAt: "2026-07-27T10:00:00.000Z",
        content: [{ type: "text", text: prompt }]
      }];
      expect(directV3StudioTool("portfolio-insight-writer", messages)).toBe(
        "analyze-portfolio-allocation"
      );
      expect(directV3StudioTool("public-research-writer", messages)).toBeNull();
      const step = await prepareStep({
        stepNumber: 0,
        messages,
        requestContext: studioContext
      } as unknown as Parameters<typeof prepareStep>[0]);
      expect(step).toEqual({
        toolChoice: {
          type: "tool",
          toolName: "analyze-portfolio-allocation"
        },
        activeTools: ["analyze-portfolio-allocation"],
        providerOptions: {
          "assistant-v3": {
            directEvidenceDispatch: true,
            currentUserMessage: prompt
          }
        }
      });
    }
  });

  it("disables direct-chat tools, processors, and scorers for customer workflow writer calls", async () => {
    let capturedOptions: Readonly<Record<string, unknown>> | undefined;
    const fakeAgent = {
      generate: async (_messages: unknown, options: Readonly<Record<string, unknown>>) => {
        capturedOptions = options;
        return {
          object: {
            claims: [{
              claimId: "claim-1",
              textTemplate: "{{F1}}",
              factRefs: ["F1"],
              citationRefs: [],
              limitations: []
            }]
          }
        };
      }
    } as unknown as Parameters<typeof draftWriterClaims>[0]["agent"];

    await draftWriterClaims({
      agent: fakeAgent,
      locale: "en-US",
      userMessage: "Explain this signed fact naturally.",
      userGoal: "explain a signed fact",
      facts: [],
      citations: [],
      timeoutMs: 1_000
    });

    expect(capturedOptions).toMatchObject({
      maxSteps: 1,
      toolChoice: "none",
      scorers: {},
      outputProcessors: []
    });
    expect(capturedOptions).not.toHaveProperty("requestContext");
  });

  it("enables bounded control-plane context without giving writers transcript memory", () => {
    expect(V3_CONVERSATION_MEMORY_POLICY).toEqual({
      type: "bounded-control-plane-context",
      enabledByDefault: true,
      writerTranscriptMemory: false,
      storesRawMessages: false,
      storesFinancialFacts: false,
      commitAfterAudit: true,
      atomicConditionalUpdates: true,
      physicalExpiry: true,
      slidingExpiry: false,
      safetyBoundariesClearContext: true,
      maximumSymbols: 2,
      defaultTtlMs: 300_000,
      defaultMaximumAssistedHops: 3,
      internalPilotStorage: "process-local",
      customerProductionStorageRequired: "encrypted-ha-ttl-store"
    });
    expect(v3Manifest.memory).toBe(V3_CONVERSATION_MEMORY_POLICY);
  });

  it("overrides hostile call settings with temperature zero and hard token limits", async () => {
    const locked = enforceLockedV3CallSettings({
      temperature: 1.7,
      maxOutputTokens: 50_000,
      providerOptions: {
        openai: {
          reasoningEffort: "max",
          textVerbosity: "high",
          store: true,
          serviceTier: "priority"
        }
      }
    });
    expect(locked).toMatchObject({
      temperature: 0,
      maxOutputTokens: 256,
      providerOptions: {
        openai: {
          store: false,
          serviceTier: "priority"
        }
      }
    });
    expect(locked.providerOptions).not.toHaveProperty("openai.reasoningEffort");
    expect(locked.providerOptions).not.toHaveProperty("openai.textVerbosity");

    let requestBody: Record<string, unknown> | undefined;
    const model = createLockedV3OpenAIModel({
      apiKey: "test-openai-key",
      fetch: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          id: "resp_test",
          object: "response",
          created_at: 1_784_716_200,
          status: "completed",
          error: null,
          incomplete_details: null,
          instructions: null,
          max_output_tokens: 256,
          model: V3_OPENAI_MODEL_ID,
          output: [{
            id: "msg_test",
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{
              type: "output_text",
              text: "ok",
              annotations: [],
              logprobs: []
            }]
          }],
          parallel_tool_calls: true,
          previous_response_id: null,
          reasoning: { effort: "none", summary: null },
          store: false,
          temperature: 0,
          text: { format: { type: "text" } },
          tool_choice: "auto",
          tools: [],
          top_p: 1,
          truncation: "disabled",
          usage: {
            input_tokens: 2,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 1,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 3
          },
          user: null,
          metadata: {}
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }) as unknown as {
      doGenerate(options: unknown): Promise<unknown>;
    };
    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      temperature: 1.7,
      maxOutputTokens: 50_000,
      providerOptions: {
        openai: {
          reasoningEffort: "max",
          textVerbosity: "high",
          store: true
        }
      }
    });
    expect(requestBody).toMatchObject({
      model: V3_OPENAI_MODEL_ID,
      temperature: 0,
      max_output_tokens: 256,
      store: false
    });
    expect(requestBody).not.toHaveProperty("reasoning");
    expect(requestBody).not.toHaveProperty("text.verbosity");

    await model.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "compare two evidence sets" }]
      }],
      providerOptions: {
        "assistant-v3": {
          modelTier: "escalation",
          selectionReasonCode: "comparison_requires_instruction_fidelity"
        },
        openai: {
          store: true
        }
      }
    });
    expect(requestBody).toMatchObject({
      model: V3_OPENAI_ESCALATION_MODEL_ID,
      temperature: 0,
      max_output_tokens: 512,
      store: false
    });
  });

  it("locks the primary and escalation model assignments", () => {
    expect(() => assertV3ModelLock(undefined)).not.toThrow();
    expect(() =>
      assertV3ModelLock("gpt-4o", "gpt-4.1")
    ).not.toThrow();
    for (const model of ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"]) {
      expect(() => assertV3ModelLock(model)).toThrow("locked to gpt-4o");
    }
    expect(() => assertV3ModelLock("gpt-4o", "gpt-4.1-mini"))
      .toThrow("escalation model is locked to gpt-4.1");
  });

  it("selects escalation only from the reviewed internal tier marker", () => {
    expect(v3ModelIdForCall({})).toBe("gpt-4o");
    expect(v3ModelIdForCall({
      providerOptions: {
        "assistant-v3": { modelTier: "escalation" }
      }
    })).toBe("gpt-4.1");
    expect(v3ModelIdForCall({
      providerOptions: {
        "assistant-v3": { modelTier: "gpt-5.6-sol" }
      }
    })).toBe("gpt-4o");
  });
});

describe("V3 private Studio bootstrap", () => {
  it("is explicitly scrubbed, loopback-only, and non-customer-facing", () => {
    expect(V3_PRIVATE_STUDIO_POLICY).toEqual({
      mode: "local-private-studio",
      host: "127.0.0.1",
      studioHost: "127.0.0.1",
      port: 4_111,
      allowedOrigins: ["http://127.0.0.1:4111", "http://localhost:4111"],
      customerExposureAllowed: false,
      customerAdaptersEnabled: false,
      directPrivateToolExecutionAllowed: false,
      toolPlaygroundMode: "one-use-granted-live-public-synthetic",
      customerDataInToolPlayground: false,
      signedOrderHandoffInToolPlayground: false,
      persistCustomerInputs: false,
      observability: {
        enabled: true,
        store: "local-duckdb",
        rawInputsPersisted: true,
        rawOutputsPersisted: true
      },
      editor: {
        enabled: true,
        source: "code",
        editableFields: ["tool-description"],
        customerRuntimeOverrides: false
      },
      memory: {
        enabled: true,
        scope: "thread",
        store: "local-libsql",
        lastMessages: 10,
        semanticRecall: false,
        workingMemory: false,
        generateTitle: false,
        customerRuntimeMemory: false
      }
    });
    expect(v3Manifest.studio).toBe(V3_PRIVATE_STUDIO_POLICY);
  });

  it("mounts full scrubbed observability and the constrained code-source Editor", async () => {
    expect(mastra.getEditor()).toBe(v3StudioEditor);
    expect(v3StudioEditor.getSource()).toBe("code");
    expect(v3StudioMemory.getMergedThreadConfig()).toMatchObject({
      lastMessages: 10,
      semanticRecall: false,
      workingMemory: { enabled: false },
      generateTitle: false
    });
    for (const writer of Object.values(mastra.listAgents()).filter(
      ({ id }) => id !== V3_FINANCIAL_TASK_PLANNER_AGENT_ID
    )) {
      expect(writer.hasOwnMemory()).toBe(true);
      expect(await writer.getMemory()).toBe(v3StudioMemory);
      expect(writer.__getEditorConfig()).toEqual({
        instructions: false,
        tools: { description: true }
      });
    }
    const planner = mastra.listAgents()[V3_FINANCIAL_TASK_PLANNER_AGENT_ID];
    expect(planner.hasOwnMemory()).toBe(false);
    expect(planner.__getEditorConfig()).toEqual({
      instructions: false,
      tools: { description: false }
    });
    expect(await v3StudioStorage.getStore("observability")).toBeDefined();
    expect(
      v3StudioObservability.getDefaultInstance()?.getConfig().serviceName
    ).toBe("governed-investment-assistant-v3-studio");
  });

  it("persists only the latest ten messages in the active Studio thread", async () => {
    const resourceId = "studio-memory-test-resource";
    const threadId = "studio-memory-test-thread";
    await v3StudioMemory.createThread({ resourceId, threadId, saveThread: true });
    const messages: MastraDBMessage[] = Array.from({ length: 12 }, (_, index) => ({
      id: `studio-memory-message-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      createdAt: new Date(1_753_180_000_000 + index),
      threadId,
      resourceId,
      content: {
        format: 2,
        parts: [{ type: "text", text: `message-${index}` }]
      }
    }));

    try {
      await v3StudioMemory.saveMessages({ messages });
      const recalled = await v3StudioMemory.recall({ threadId, resourceId });

      expect(recalled.messages).toHaveLength(10);
      expect(
        recalled.messages.map(({ content }) =>
          content.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("")
        )
      ).toEqual(Array.from({ length: 10 }, (_, index) => `message-${index + 2}`));
      await expect(
        v3StudioMemory.getWorkingMemory({ threadId, resourceId })
      ).resolves.toBeNull();
    } finally {
      await v3StudioMemory.deleteThread(threadId);
    }
  });

  it("rejects production, explicit exposure, and non-loopback Studio binding", () => {
    const invalidEnvironments: NodeJS.ProcessEnv[] = [
      { NODE_ENV: "production" },
      { NODE_ENV: "development", ASSISTANT_STUDIO_EXPOSED: "true" },
      { NODE_ENV: "development", ASSISTANT_STUDIO_EXPOSED: "typo" },
      { NODE_ENV: "development", HOST: "0.0.0.0" }
    ];
    for (const environment of invalidEnvironments) {
      expect(() => assertPrivateV3StudioEnvironment(environment)).toThrow(
        V3PrivateStudioError
      );
    }
    expect(() => assertPrivateV3StudioEnvironment({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      ASSISTANT_STUDIO_EXPOSED: "false"
    })).not.toThrow();
    // Mastra bundles its dev server with NODE_ENV=production. The npm script
    // supplies this exact profile while the remaining loopback/exposure guards
    // stay active.
    expect(() => assertPrivateV3StudioEnvironment({
      NODE_ENV: "production",
      ASSISTANT_PRIVATE_STUDIO_LAUNCH: "local-loopback",
      HOST: "127.0.0.1",
      ASSISTANT_STUDIO_EXPOSED: "false"
    })).not.toThrow();
  });

  it("does not mount a callable customer adapter behind Studio tools", async () => {
    const execute = (v3BoundaryTools["read-market-snapshot"] as {
      execute?: (input: unknown, runtime: unknown) => Promise<unknown>;
    }).execute;
    expect(execute).toBeTypeOf("function");
    await expect(execute?.({ symbol: "NVDA" }, {})).rejects.toMatchObject({
      code: "internal_grant_required"
    });
  });

  it("keeps the reviewed Mastra core range and directs the Studio script to the V3 folder", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(packageJson.dependencies["@mastra/core"]).toBe("^1.53.0");
    expect(packageJson.dependencies["@mastra/memory"]).toBeUndefined();
    expect(packageJson.dependencies["@mastra/editor"]).toBeUndefined();
    expect(packageJson.devDependencies["@mastra/memory"]).toBe("1.23.1");
    expect(packageJson.devDependencies["@mastra/editor"]).toBe("0.13.8");
    expect(packageJson.scripts.studio).toContain(
      "ASSISTANT_PRIVATE_STUDIO_LAUNCH=local-loopback"
    );
    expect(packageJson.scripts.studio).toContain("HOST=127.0.0.1");
    expect(packageJson.scripts.studio).toContain("mastra dev --dir src/assistant-v3");
    expect(packageJson.scripts.studio).not.toContain("0.0.0.0");
  });
});
