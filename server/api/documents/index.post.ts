import { Primitive } from "db0";

export default defineLazyEventHandler(async () => {
  const dbService = await getDatabaseService();
  const { embeddingContext } = await useAiContext();

  return defineEventHandler(async (event) => {
    const { disableWrite } = useRuntimeConfig(event);
    if (disableWrite) {
      throw createError({
        statusCode: 403,
        statusMessage: "Forbidden",
        message: "Write operations are disabled",
      });
    }

    const { documents, indices } = await readBody<{
      documents: Record<string, any>[];
      indices?: string[];
    }>(event);

    if (!Array.isArray(documents) || documents.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "Bad Request",
        message: "No documents provided",
      });
    }

    try {
      // Insert each document and its embeddings
      let insertedCount = 0;

      // Track which indices were used
      const indexUsageSummary: Record<string, number> = {};

      for (const document of documents) {
        // Insert the document
        const documentId = await dbService.addDocument(document);

        // Find all applicable indices for this document
        const applicableIndices = await dbService.findApplicableIndices(document);

        // If indices parameter was provided, intersect with applicable indices
        // Otherwise, use all applicable indices
        const indicesToUse = indices && indices.length > 0
          ? applicableIndices.filter(idx => indices.includes(idx.name))
          : applicableIndices;

        if (indicesToUse.length === 0) {
          console.warn(`Document ${documentId} has no applicable indices${
            indices ? ' among the requested indices' : ''
          }`);
        }

        // Create embeddings for each applicable index
        const embeddingEntries = [];

        for (const index of indicesToUse) {
          // Extract text using property path
          const textContent = await dbService.extractTextByPropertyPath(
            documentId,
            index.indexedPropertyPath
          );

          if (textContent) {
            const embedding = await embeddingContext.getEmbeddingFor(textContent);

            embeddingEntries.push({
              documentId,
              indexId: index.id,
              vector: embedding.vector
            });

            // Update usage summary
            indexUsageSummary[index.name] = (indexUsageSummary[index.name] || 0) + 1;
          }
        }

        // Add all embeddings in one batch
        if (embeddingEntries.length > 0) {
          await dbService.addEmbeddings(embeddingEntries);
        }

        insertedCount++;
      }

      // Create a summary of which indices were used
      const indexSummary = Object.entries(indexUsageSummary)
        .map(([name, count]) => `${name} (${count}/${insertedCount})`)
        .join(', ');

      return {
        success: true,
        count: insertedCount,
        indices: indexSummary || "No applicable indices found"
      };

    } catch (error) {
      console.error("Error inserting documents:", error);
      throw createError({
        statusCode: 500,
        statusMessage: "Internal Server Error",
        cause: error,
        message: error.message || "Failed to insert documents",
      });
    }
  });
});
