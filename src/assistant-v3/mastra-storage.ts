import { InMemoryStore, MastraCompositeStore } from "@mastra/core/storage";
import { DuckDBStore } from "@mastra/duckdb";
import { LibSQLStore } from "@mastra/libsql";

export interface CreateAssistantV3MastraStorageOptions {
  /** Stable identifier for the composite registered with Mastra. */
  readonly id: string;
  /** Explicit LibSQL URL, including `:memory:` for isolated tests. */
  readonly defaultUrl: string;
  /** Explicit DuckDB path, including `:memory:` for isolated tests. */
  readonly observabilityPath: string;
  readonly defaultStoreId?: string;
  readonly observabilityStoreId?: string;
  readonly defaultAuthToken?: string;
  readonly connectionTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly initialBackoffMs?: number;
}

function requiredValue(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new TypeError(`${label} must be provided and cannot be empty.`);
  }
  return normalized;
}

async function closeUnderlyingStores(
  defaultStore: LibSQLStore,
  observabilityStore: DuckDBStore,
  volatileWorkflowStore: InMemoryStore
): Promise<void> {
  // Start each close in its own promise so a synchronous adapter failure
  // cannot prevent the other database handle from being released.
  const results = await Promise.allSettled([
    Promise.resolve().then(() => defaultStore.close()),
    Promise.resolve().then(() => observabilityStore.close()),
    Promise.resolve().then(() => volatileWorkflowStore.clear())
  ]);
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "Failed to close Assistant V3 Mastra storage."
    );
  }
}

/**
 * Assistant V3 storage topology.
 *
 * LibSQL owns regular Mastra domains other than workflows. Customer workflow
 * snapshots are process-local because they can contain request and intermediate
 * step data; DuckDB owns the separately scrubbed observability domain.
 */
export class AssistantV3MastraStorage extends MastraCompositeStore {
  readonly defaultStore: LibSQLStore;
  readonly observabilityStore: DuckDBStore;
  readonly volatileWorkflowStore: InMemoryStore;

  private closePromise: Promise<void> | undefined;

  constructor(options: CreateAssistantV3MastraStorageOptions) {
    const id = requiredValue(options.id, "Assistant V3 storage id");
    const defaultUrl = requiredValue(
      options.defaultUrl,
      "Assistant V3 default storage URL"
    );
    const observabilityPath = requiredValue(
      options.observabilityPath,
      "Assistant V3 observability storage path"
    );
    const defaultStoreId = requiredValue(
      options.defaultStoreId ?? `${id}-default`,
      "Assistant V3 default store id"
    );
    const observabilityStoreId = requiredValue(
      options.observabilityStoreId ?? `${id}-observability`,
      "Assistant V3 observability store id"
    );

    const defaultStore = new LibSQLStore({
      id: defaultStoreId,
      url: defaultUrl,
      ...(options.defaultAuthToken === undefined
        ? {}
        : { authToken: options.defaultAuthToken }),
      ...(options.connectionTimeoutMs === undefined
        ? {}
        : { connectionTimeoutMs: options.connectionTimeoutMs }),
      ...(options.maxRetries === undefined
        ? {}
        : { maxRetries: options.maxRetries }),
      ...(options.initialBackoffMs === undefined
        ? {}
        : { initialBackoffMs: options.initialBackoffMs })
    });
    const observabilityStore = new DuckDBStore({
      id: observabilityStoreId,
      path: observabilityPath
    });
    const volatileWorkflowStore = new InMemoryStore({
      id: `${id}-volatile-workflows`
    });
    const workflowDomain = volatileWorkflowStore.stores.workflows;
    if (workflowDomain === undefined) {
      throw new TypeError("Assistant V3 volatile workflow storage is unavailable.");
    }

    super({
      id,
      default: defaultStore,
      domains: {
        workflows: workflowDomain,
        observability: observabilityStore.observability
      }
    });

    this.defaultStore = defaultStore;
    this.observabilityStore = observabilityStore;
    this.volatileWorkflowStore = volatileWorkflowStore;
  }

  /**
   * Release both parent database handles exactly once.
   *
   * Mastra invokes this hook during `shutdown()`. Retaining the promise also
   * makes an earlier application-level close and repeated/concurrent shutdowns
   * harmless instead of asking either native database adapter to close twice.
   */
  override close(): Promise<void> {
    this.closePromise ??= closeUnderlyingStores(
      this.defaultStore,
      this.observabilityStore,
      this.volatileWorkflowStore
    );
    return this.closePromise;
  }
}

export function createAssistantV3MastraStorage(
  options: CreateAssistantV3MastraStorageOptions
): AssistantV3MastraStorage {
  return new AssistantV3MastraStorage(options);
}
