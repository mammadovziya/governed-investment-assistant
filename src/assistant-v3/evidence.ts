import { randomUUID } from "node:crypto";
import type {
  DecimalString,
  EnvelopeIntegrity,
  FactEnvelope,
  FactProvenance,
  ToolExecutionEnvelope,
  ToolSource
} from "./contracts.js";
import { decimal } from "./fixed-decimal.js";
import {
  attachIntegrity,
  canonicalHash,
  DevHmacSigner,
  verifyEnvelope
} from "./signing.js";

export class EvidenceFactory {
  readonly #signer: DevHmacSigner;
  readonly #now: () => number;

  constructor(input: { signer: DevHmacSigner; now?: () => number }) {
    this.#signer = input.signer;
    this.#now = input.now ?? Date.now;
  }

  toolSuccess<TResult>(input: {
    requestId: string;
    workflowRunId: string;
    toolId: string;
    toolVersion: string;
    arguments: unknown;
    result: TResult;
    source: ToolSource;
    startedAt?: string;
  }): ToolExecutionEnvelope<TResult> {
    const completedAt = new Date(this.#now()).toISOString();
    const payload: Omit<ToolExecutionEnvelope<TResult>, "integrity"> = {
      schemaVersion: "assistant-v3.tool-execution.v1",
      executionId: randomUUID(),
      requestId: input.requestId,
      workflowRunId: input.workflowRunId,
      toolId: input.toolId,
      toolVersion: input.toolVersion,
      status: "success",
      startedAt: input.startedAt ?? completedAt,
      completedAt,
      argumentsHash: canonicalHash(input.arguments),
      resultHash: canonicalHash(input.result),
      result: input.result,
      error: null,
      source: input.source
    };
    return attachIntegrity(payload, this.#signer);
  }

  toolUnavailable(input: {
    requestId: string;
    workflowRunId: string;
    toolId: string;
    toolVersion: string;
    arguments: unknown;
    source: ToolSource;
    code: string;
    message: string;
    retryable: boolean;
    startedAt?: string;
  }): ToolExecutionEnvelope<never> {
    const completedAt = new Date(this.#now()).toISOString();
    const payload: Omit<ToolExecutionEnvelope<never>, "integrity"> = {
      schemaVersion: "assistant-v3.tool-execution.v1",
      executionId: randomUUID(),
      requestId: input.requestId,
      workflowRunId: input.workflowRunId,
      toolId: input.toolId,
      toolVersion: input.toolVersion,
      status: "unavailable",
      startedAt: input.startedAt ?? completedAt,
      completedAt,
      argumentsHash: canonicalHash(input.arguments),
      resultHash: null,
      result: null,
      error: {
        code: input.code,
        message: input.message,
        retryable: input.retryable
      },
      source: input.source
    };
    return attachIntegrity(payload, this.#signer);
  }

  fact<TValue>(input: {
    requestId: string;
    workflowRunId: string;
    kind: string;
    subject: FactEnvelope<TValue>["subject"];
    asOf: string;
    value: TValue;
    provenance: FactProvenance;
    quality?: FactEnvelope<TValue>["quality"];
  }): FactEnvelope<TValue> {
    const payload: Omit<FactEnvelope<TValue>, "integrity"> = {
      schemaVersion: "assistant-v3.fact.v1",
      factId: randomUUID(),
      requestId: input.requestId,
      workflowRunId: input.workflowRunId,
      kind: input.kind,
      subject: input.subject,
      asOf: input.asOf,
      createdAt: new Date(this.#now()).toISOString(),
      value: input.value,
      provenance: input.provenance,
      quality: input.quality ?? {
        status: "complete",
        coverage: decimal("1") as DecimalString,
        flags: []
      }
    };
    return attachIntegrity(payload, this.#signer);
  }

  verifyTool<TResult>(envelope: ToolExecutionEnvelope<TResult>): boolean {
    if (!verifyEnvelope(envelope, this.#signer)) return false;
    return envelope.status === "success"
      ? envelope.result !== null && envelope.resultHash === canonicalHash(envelope.result)
      : envelope.result === null && envelope.resultHash === null && envelope.error !== null;
  }

  verifyFact<TValue>(
    envelope: FactEnvelope<TValue>,
    tools: readonly ToolExecutionEnvelope<unknown>[] = [],
    inputFacts: readonly FactEnvelope<unknown>[] = []
  ): boolean {
    if (!verifyEnvelope(envelope, this.#signer)) return false;
    const toolsById = new Map(tools.map((tool) => [tool.executionId, tool]));
    const factsById = new Map(inputFacts.map((fact) => [fact.factId, fact]));
    return envelope.provenance.toolExecutionIds.every((executionId) => {
      const tool = toolsById.get(executionId);
      return tool !== undefined &&
        tool.requestId === envelope.requestId &&
        tool.workflowRunId === envelope.workflowRunId &&
        this.verifyTool(tool);
    }) && envelope.provenance.inputFactIds.every((factId) => {
      const fact = factsById.get(factId);
      return fact !== undefined &&
        fact.requestId === envelope.requestId &&
        fact.workflowRunId === envelope.workflowRunId &&
      verifyEnvelope(fact, this.#signer);
    });
  }

  /**
   * Signs a deterministic, in-process presentation projection. This binds the
   * exact display text and its semantic label to the already signed parent
   * fact so neither the renderer nor the numeric scorer has to trust a loose
   * formatter string.
   */
  sealProjection(payload: unknown): EnvelopeIntegrity {
    return this.#signer.seal(payload);
  }

  verifyProjection(payload: unknown, integrity: EnvelopeIntegrity): boolean {
    return this.#signer.verifyIntegrity(payload, integrity);
  }
}
