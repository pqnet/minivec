import { Primitive } from "db0";

export default defineLazyEventHandler(async () => {
  const dbService = await getDatabaseService();
  const { embeddingContext, rankingContext } = await useAiContext();

  return defineEventHandler(async (event) => {
    // Get query parameters
    const query = getQuery(event);
    const q = [query.q].flat().join(" ");
    const n = parseInt(query.n as string) || 5; // Default to 5 if not provided
    const indexName = query.index as string || 'default'; // Default to the default index

    if (!q) {
      return {
        error: 'Query parameter "q" is required',
        results: [],
      };
    }

    try {
      console.log(
        `[${new Date().toISOString()}] Calculating embedding for query:`,
        q
      );
      const embedding = await embeddingContext.getEmbeddingFor(q);

      // Calculate k for retrieval (n+1) * 5 for reranking
      const k = (n + 1) * 5;

      console.log(
        `[${new Date().toISOString()}] Searching for documents similar to:`,
        q,
        `using index: ${indexName}`
      );

      // Get candidate documents
      const documents = await dbService.searchDocumentsByVector(
        embedding.vector,
        indexName,
        k
      );

      if (!documents.length) {
        return { results: [] };
      }

      // Get the index for property path
      const index = await dbService.getIndexByName(indexName);
      if (!index) {
        throw new Error(`Index "${indexName}" not found`);
      }

      // Extract content for reranking
      const contents: string[] = [];
      for (const doc of documents) {
        const text = await dbService.extractTextByPropertyPath(doc.id, index.indexedPropertyPath);
        contents.push(text || '');
      }

      // Rerank the results
      console.log(
        `[${new Date().toISOString()}] Reranking ${
          documents.length
        } documents`
      );
      const scores = await rankingContext.rankAll(q, contents);

      // Combine and return results
      const results = documents
        .map((doc, i) => ({
          document: doc.data,
          score: scores[i]
        }))
        .slice(0, n);

      console.log(
        `[${new Date().toISOString()}] Found ${results.length} results`
      );

      return { results };
    } catch (error) {
      console.error("Error searching documents:", error);
      throw createError({
        statusCode: error.message?.includes('not found') ? 400 : 500,
        statusMessage: error.message?.includes('not found') ? "Bad Request" : "Internal Server Error",
        cause: error,
        message: error.message || "Failed to search documents",
      });
    }
  });
});
