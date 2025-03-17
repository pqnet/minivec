export default defineLazyEventHandler(async () => {
  const dbService = await getDatabaseService();
  const { embeddingContext } = await useAiContext();

  return defineEventHandler(async (event) => {
    const method = event.method;
    const { disableWrite } = useRuntimeConfig(event);

    // GET - List all indices
    if (method === "GET") {
      const indices = await dbService.listIndices();
      return indices;
    }

    // POST - Create a new index
    if (method === "POST") {
      if (disableWrite) {
        throw createError({
          statusCode: 403,
          statusMessage: "Forbidden",
          message: "Write operations are disabled",
        });
      }

      const body = await readBody(event);

      if (!body.name || !body.indexedPropertyPath) {
        throw createError({
          statusCode: 400,
          statusMessage: "Bad Request",
          message: "Name and indexedPropertyPath are required",
        });
      }

      try {
        const result = await dbService.createIndex(
          body.name,
          body.indexedPropertyPath,
          body.description
        );

        while (true) {
          const documentsForIndexing = await dbService.getDocumentsForIndexing(
            body.name
          );
          if (!documentsForIndexing.length) {
            break;
          }
          // Index the documents
          const embeddingEntries = await Promise.all(
            documentsForIndexing.map(async (d) => {
              const embedding = await embeddingContext.getEmbeddingFor(
                d.textContent
              );
              return {
                documentId: d.id,
                indexId: result.id,
                vector: embedding.vector,
              };
            })
          );
          await dbService.addEmbeddings(embeddingEntries);
        }
        return result;
      } catch (error) {
        if (error.message?.includes("UNIQUE constraint failed")) {
          throw createError({
            statusCode: 409,
            statusMessage: "Conflict",
            message: `Index with name "${body.name}" already exists`,
          });
        }

        if (error.message?.includes("Invalid property path")) {
          throw createError({
            statusCode: 400,
            statusMessage: "Bad Request",
            message: error.message,
          });
        }

        throw createError({
          statusCode: 500,
          statusMessage: "Internal Server Error",
          message: error.message || "Failed to create index",
          cause: error,
        });
      }
    }

    throw createError({
      statusCode: 405,
      statusMessage: "Method Not Allowed",
      message: `Method ${method} not allowed`,
    });
  });
});
