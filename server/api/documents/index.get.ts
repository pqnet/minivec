import { Primitive } from "db0";

export default defineLazyEventHandler(async () => {
  const db = await getDb();
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
      // Calculate k for retrieval (n+1) * 5
      const k = (n + 1) * 5;

      // Get the specified index
      const indexQuery = await db.sql`
        SELECT id, indexed_property_path FROM indices WHERE name = ${indexName} LIMIT 1
      `;

      if (!indexQuery.rows.length) {
        throw createError({
          statusCode: 400,
          statusMessage: "Bad Request",
          message: `Index "${indexName}" not found`,
        });
      }

      const indexId = indexQuery.rows[0].id;
      
      // Calculate embedding for the query
      console.log(
        `[${new Date().toISOString()}] Calculating embedding for query:`,
        q
      );
      const embedding = await embeddingContext.getEmbeddingFor(q);

      // Find closest documents in the database using cosine distance
      console.log(
        `[${new Date().toISOString()}] Searching for documents similar to:`,
        q,
        `using index: ${indexName}`
      );
      
      const documents = await db.sql`
        SELECT d.id, d.data
        FROM documents d
        JOIN embeddings e ON d.id = e.document_id
        WHERE e.index_id = ${indexId}
        ORDER BY vec_distance_cosine(e.vector, ${
          new Float32Array(embedding.vector) as unknown as Primitive
        }) ASC
        LIMIT ${k}
      `;

      if (!documents || documents.rows.length === 0) {
        return { results: [] };
      }

      // Get the indexed property path for content extraction
      const indexedPropertyPath = indexQuery.rows[0].indexed_property_path;
      
      // Extract the indexed content for each document for reranking
      const contents = [];
      for (const doc of documents.rows) {
        const contentQuery = await db.sql`
          SELECT ${doc.data} ->> ${indexedPropertyPath} as text_content
        `;
        contents.push(contentQuery.rows[0]?.text_content || '');
      }

      // Rerank the results using the reranker
      console.log(
        `[${new Date().toISOString()}] Reranking ${
          documents.rows.length
        } documents`
      );
      
      const scores = await rankingContext.rankAll(q, contents);
      
      const results = documents.rows
        .map((document, i) => ({
          document: document.data,
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
