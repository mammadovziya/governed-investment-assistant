import { LibSQLVector } from "@mastra/libsql";

import { config } from "../src/config.js";
import { approvedProductKnowledgeDocuments } from "../src/data/approved-product-knowledge.js";
import { KnowledgeRegistry } from "../src/services/knowledge-registry.js";
import { ApprovedKnowledgeService } from "../src/services/knowledge-retrieval.js";

// Knowledge promotion must not open the assistant workflow store. This keeps
// ingestion independent from a running API or private Studio process and
// prevents a vector-only operation from contending for workflow snapshots.
const knowledgeVector = new LibSQLVector({
  id: "approved-product-knowledge-ingestion",
  url: config.knowledgeVectorUrl,
  maxRetries: 5,
  initialBackoffMs: 100,
  vectorTopKOverFetchMultiplier: 20
});
const approvedKnowledge = new ApprovedKnowledgeService({
  registry: new KnowledgeRegistry(
    approvedProductKnowledgeDocuments,
    config.knowledgeApprovalMode
  ),
  vectorStore: knowledgeVector,
  indexName: config.knowledgeIndexName,
  indexGeneration: config.knowledgeIndexGeneration,
  minimumScore: config.knowledgeMinimumScore
});

async function main(): Promise<void> {
  await approvedKnowledge.ensureIndexed();
  const readiness = await approvedKnowledge.readiness();
  process.stdout.write(`${JSON.stringify({
    operation: "approved-knowledge-ingestion",
    ...readiness
  }, null, 2)}\n`);
  if (!readiness.ready) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    operation: "approved-knowledge-ingestion",
    status: "failed",
    error: error instanceof Error ? error.message : "Unknown ingestion error"
  })}\n`);
  process.exitCode = 1;
} finally {
  await knowledgeVector.close();
}
