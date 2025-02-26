import { Primitive } from "db0";

export default defineLazyEventHandler(async () => {
  const db = await getDb();
  const { embeddingContext, rankingContext } = await useAiContext();
  return defineEventHandler(async (event) => {
    // Get query parameters
    const query = getQuery(event);
    const q = [query.q].flat().join(" ");
    const n = parseInt(query.n as string) || 5; // Default to 5 if not provided

    if (!q) {
      return {
        error: 'Query parameter "q" is required',
        results: [],
      };
    }

    try {
      // Calculate k for retrieval (n+1) * 5
      const k = (n + 1) * 5;

      // Calculate embedding for the query
      console.log(
        `[${new Date().toISOString()}] Calculating embedding for query:`,
        q
      );
      const embedding = await embeddingContext.getEmbeddingFor(q);

      // Find closest documents in the database using cosine distance
      console.log(
        `[${new Date().toISOString()}] Searching for documents similar to:`,
        q
      );
      const documents = await db.sql<{
        rows: Array<{ id: number; content: string; metadata: string }>;
      }>`
            SELECT id, content, json(metadata) metadata FROM documents
            ORDER BY vec_distance_cosine(embedding, ${
              new Float32Array(embedding.vector) as unknown as Primitive
            }) ASC
            LIMIT ${k}
        `;

      if (!documents || documents.rows.length === 0) {
        return { results: [] };
      }

      // Rerank the results using the reranker
      console.log(
        `[${new Date().toISOString()}] Reranking ${
          documents.rows.length
        } documents`
      );
      const scores = await rankingContext.rankAll(
        q,
        documents.rows.map((doc) => doc.content)
      );
      const results = documents.rows
        .map((document, i) => ({
          document: { ...document, metadata: JSON.parse(document.metadata) },
          score: scores[i],
        }))
        .slice(0, n);
      // Return the n highest ranked results
      console.log(
        `[${new Date().toISOString()}] Found ${results.length} results`
      );
      return {
        results,
      };
    } catch (error) {
      console.error("Error searching documents:", error);
      throw createError({
        statusCode: 500,
        statusMessage: "Internal Server Error",
        cause: error,
        message: "Failed to search documents",
      });
    }
  });
});
