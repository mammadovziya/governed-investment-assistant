export interface RetrievalJudgment {
  retrievedIds: readonly string[];
  relevantIds: readonly string[];
}

export interface RetrievalQualityMetrics {
  recallAtK: number;
  meanReciprocalRank: number;
  normalizedDiscountedCumulativeGainAtK: number;
  queryCount: number;
  k: number;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function discountedCumulativeGain(relevances: readonly number[]): number {
  return relevances.reduce(
    (total, relevance, index) => total + relevance / Math.log2(index + 2),
    0
  );
}

/** Binary-relevance IR metrics used by the governed-RAG promotion gate. */
export function evaluateRetrievalQuality(
  judgments: readonly RetrievalJudgment[],
  k = 5
): RetrievalQualityMetrics {
  if (judgments.length === 0) throw new Error("Retrieval quality requires at least one judgment.");
  if (!Number.isInteger(k) || k < 1) throw new Error("Retrieval metric k must be a positive integer.");

  const perQuery = judgments.map(({ retrievedIds, relevantIds }) => {
    const relevant = new Set(relevantIds);
    if (relevant.size === 0) throw new Error("Every retrieval judgment needs relevant evidence.");

    const seen = new Set<string>();
    const relevanceAtK = retrievedIds.slice(0, k).map((id) => {
      const isRelevant = relevant.has(id) && !seen.has(id);
      seen.add(id);
      return isRelevant ? 1 : 0;
    });
    const recalled = relevanceAtK.reduce<number>((total, value) => total + value, 0);
    const firstRelevantRank = retrievedIds.findIndex((id) => relevant.has(id));
    const idealRelevance = Array.from(
      { length: Math.min(k, relevant.size) },
      () => 1
    );
    const idealDcg = discountedCumulativeGain(idealRelevance);

    return {
      recallAtK: recalled / relevant.size,
      reciprocalRank: firstRelevantRank < 0 ? 0 : 1 / (firstRelevantRank + 1),
      ndcgAtK: idealDcg === 0 ? 0 : discountedCumulativeGain(relevanceAtK) / idealDcg
    };
  });

  return {
    recallAtK: mean(perQuery.map(({ recallAtK }) => recallAtK)),
    meanReciprocalRank: mean(perQuery.map(({ reciprocalRank }) => reciprocalRank)),
    normalizedDiscountedCumulativeGainAtK: mean(perQuery.map(({ ndcgAtK }) => ndcgAtK)),
    queryCount: judgments.length,
    k
  };
}
