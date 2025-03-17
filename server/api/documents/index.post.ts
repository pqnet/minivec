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

    const { documents, indices = ['default'] } = await readBody<{
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
      // Get requested indices
      const indexObjects = [];
      for (const indexName of indices) {
        const index = await dbService.getIndexByName(indexName);
        if (!index) {
          throw new Error(`Index "${indexName}" not found`);
        }
        indexObjects.push(index);
      }

      // Insert each document and its embeddings
      let insertedCount = 0;

      for (const document of documents) {
        // Insert the document
        const documentId = await dbService.addDocument(document);

        // Create embeddings for each index
        const embeddingEntries = [];

        for (const index of indexObjects) {
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
          }
        }

        // Add all embeddings in one batch
        if (embeddingEntries.length > 0) {
          await dbService.addEmbeddings(embeddingEntries);
        }

        insertedCount++;
      }

      return { success: true, count: insertedCount };

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
