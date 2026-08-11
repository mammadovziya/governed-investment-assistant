import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore, MastraCompositeStore } from "@mastra/core/storage";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { DuckDBStore } from "@mastra/duckdb";
import { LibSQLStore } from "@mastra/libsql";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AssistantV3MastraStorage,
  createAssistantV3MastraStorage
} from "../src/assistant-v3/mastra-storage.js";

function inMemoryStorage(id: string): AssistantV3MastraStorage {
  return createAssistantV3MastraStorage({
    id,
    defaultUrl: ":memory:",
    observabilityPath: ":memory:"
  });
}

describe("Assistant V3 Mastra composite storage", () => {
  it("routes workflows to volatile memory, regular domains to LibSQL, and observability to DuckDB", async () => {
    const storage = inMemoryStorage("assistant-v3-storage-routing");
    try {
      expect(storage).toBeInstanceOf(MastraCompositeStore);
      expect(storage.defaultStore).toBeInstanceOf(LibSQLStore);
      expect(storage.observabilityStore).toBeInstanceOf(DuckDBStore);
      expect(storage.volatileWorkflowStore).toBeInstanceOf(InMemoryStore);

      expect(await storage.getStore("workflows")).toBe(
        await storage.volatileWorkflowStore.getStore("workflows")
      );
      expect(await storage.getStore("workflows")).not.toBe(
        await storage.defaultStore.getStore("workflows")
      );
      expect(await storage.getStore("memory")).toBe(
        await storage.defaultStore.getStore("memory")
      );
      expect(await storage.getStore("observability")).toBe(
        storage.observabilityStore.observability
      );
      expect(await storage.getStore("observability")).not.toBe(
        await storage.defaultStore.getStore("observability")
      );

      await expect(storage.init()).resolves.toBeUndefined();
    } finally {
      await storage.close();
    }
  });

  it("stores no ordinary-turn snapshot on disk and resumes an order-style suspension only from volatile memory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "assistant-v3-volatile-workflows-"));
    const defaultPath = join(directory, "mastra.db");
    const storage = createAssistantV3MastraStorage({
      id: "assistant-v3-volatile-workflow-proof",
      defaultUrl: pathToFileURL(defaultPath).href,
      observabilityPath: ":memory:"
    });
    const payloadSchema = z.object({ marker: z.string() }).strict();
    const ordinaryStep = createStep({
      id: "return-quote-like-result",
      inputSchema: payloadSchema,
      outputSchema: payloadSchema,
      execute: async ({ inputData }) => inputData
    });
    const ordinaryWorkflow = createWorkflow({
      id: "quote-like-no-snapshot",
      inputSchema: payloadSchema,
      outputSchema: payloadSchema,
      options: { shouldPersistSnapshot: () => false }
    }).then(ordinaryStep).commit();
    const suspendedStep = createStep({
      id: "await-explicit-confirmation",
      inputSchema: payloadSchema,
      outputSchema: payloadSchema,
      suspendSchema: payloadSchema,
      resumeSchema: z.object({ confirmed: z.literal(true) }).strict(),
      execute: async ({ inputData, resumeData, suspend }) =>
        resumeData ? inputData : await suspend(inputData)
    });
    const orderWorkflow = createWorkflow({
      id: "order-like-volatile-snapshot",
      inputSchema: payloadSchema,
      outputSchema: payloadSchema
    }).then(suspendedStep).commit();
    const mastra = new Mastra({
      storage,
      logger: false,
      workflows: {
        ordinaryWorkflow,
        orderWorkflow
      }
    });

    try {
      const ordinaryRun = await ordinaryWorkflow.createRun();
      const ordinaryResult = await ordinaryRun.start({
        inputData: { marker: "ordinary-request" }
      });
      expect(ordinaryResult.status).toBe("success");

      const volatileWorkflows = await storage.getStore("workflows");
      const durableWorkflows = await storage.defaultStore.getStore("workflows");
      expect(volatileWorkflows).toBeDefined();
      expect(durableWorkflows).toBeDefined();
      if (volatileWorkflows === undefined || durableWorkflows === undefined) {
        throw new Error("Workflow stores must be available.");
      }
      const durableWorkflowRunCount = async (): Promise<number> => {
        try {
          return (await durableWorkflows.listWorkflowRuns()).total;
        } catch (error) {
          // Newer Mastra cores initialize only the composite's selected
          // workflow domain. An absent durable snapshot table is therefore
          // stronger evidence than an initialized-but-empty table.
          if (
            error instanceof Error &&
            /no such table:\s*mastra_workflow_snapshot/iu.test(error.message)
          ) {
            return 0;
          }
          throw error;
        }
      };
      expect((await volatileWorkflows.listWorkflowRuns()).total).toBe(0);
      expect(await durableWorkflowRunCount()).toBe(0);

      const orderRun = await orderWorkflow.createRun();
      const suspended = await orderRun.start({
        inputData: { marker: "order-preview" }
      });
      expect(suspended.status).toBe("suspended");
      expect((await volatileWorkflows.listWorkflowRuns()).total).toBe(1);
      expect(await durableWorkflowRunCount()).toBe(0);

      const resumed = await orderRun.resume({
        step: "await-explicit-confirmation",
        resumeData: { confirmed: true }
      });
      expect(resumed.status).toBe("success");
      expect(await durableWorkflowRunCount()).toBe(0);
    } finally {
      await mastra.shutdown();
      await rm(directory, { recursive: true });
    }
  });

  it("honors explicit file URLs and paths as well as in-memory locations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "assistant-v3-storage-"));
    const defaultPath = join(directory, "mastra.db");
    const observabilityPath = join(directory, "observability.duckdb");
    const storage = createAssistantV3MastraStorage({
      id: "assistant-v3-storage-files",
      defaultUrl: pathToFileURL(defaultPath).href,
      observabilityPath
    });

    try {
      await storage.init();
      expect(existsSync(defaultPath)).toBe(true);
      expect(existsSync(observabilityPath)).toBe(true);
    } finally {
      await storage.close();
      await rm(directory, { recursive: true });
    }
  });

  it("closes both stores only once across direct close and Mastra shutdown", async () => {
    const storage = inMemoryStorage("assistant-v3-storage-lifecycle");
    await storage.init();
    const defaultClose = vi.spyOn(storage.defaultStore, "close");
    const observabilityClose = vi.spyOn(storage.observabilityStore, "close");
    const mastra = new Mastra({
      storage,
      logger: false
    });

    await Promise.all([storage.close(), storage.close()]);
    await expect(mastra.shutdown()).resolves.toBeUndefined();
    await expect(mastra.shutdown()).resolves.toBeUndefined();

    expect(defaultClose).toHaveBeenCalledTimes(1);
    expect(observabilityClose).toHaveBeenCalledTimes(1);
  });

  it("still closes the second store when the first close fails", async () => {
    const storage = inMemoryStorage("assistant-v3-storage-close-failure");
    const failure = new Error("default close failed");
    const releaseDefaultStore = storage.defaultStore.close.bind(
      storage.defaultStore
    );
    const defaultClose = vi
      .spyOn(storage.defaultStore, "close")
      .mockRejectedValue(failure);
    const observabilityClose = vi.spyOn(
      storage.observabilityStore,
      "close"
    );

    try {
      await expect(storage.close()).rejects.toBe(failure);
      await expect(storage.close()).rejects.toBe(failure);

      expect(defaultClose).toHaveBeenCalledTimes(1);
      expect(observabilityClose).toHaveBeenCalledTimes(1);
    } finally {
      defaultClose.mockRestore();
      await releaseDefaultStore();
    }
  });

  it("rejects empty identifiers and locations before constructing adapters", () => {
    expect(() => createAssistantV3MastraStorage({
      id: " ",
      defaultUrl: ":memory:",
      observabilityPath: ":memory:"
    })).toThrow("storage id must be provided");
    expect(() => createAssistantV3MastraStorage({
      id: "assistant-v3-storage-empty-default",
      defaultUrl: " ",
      observabilityPath: ":memory:"
    })).toThrow("default storage URL must be provided");
    expect(() => createAssistantV3MastraStorage({
      id: "assistant-v3-storage-empty-observability",
      defaultUrl: ":memory:",
      observabilityPath: ""
    })).toThrow("observability storage path must be provided");
  });
});
