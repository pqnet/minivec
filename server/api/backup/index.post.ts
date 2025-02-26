import { Primitive } from "db0";

export default defineLazyEventHandler(async () => {
  const db = await getDb();
  const { embeddingContext } = await useAiContext();

  return defineEventHandler(async (event) => {
    // Check if write operations are disabled
    const { disableWrite } = useRuntimeConfig(event);
    if (disableWrite) {
      throw createError({
        statusCode: 403,
        statusMessage: "Forbidden",
        message: "Write operations are disabled",
      });
    }

    try {
      const { documents } = await readBody<{
        documents: Array<{ id?: number; content: string; metadata: unknown }>;
      }>(event);

      if (!Array.isArray(documents) || documents.length === 0) {
        throw createError({
          statusCode: 400,
          statusMessage: "Bad Request",
          message: "No documents provided in backup file",
        });
      }

      // Begin transaction
      await db.sql`BEGIN TRANSACTION`;

      try {
        // Clear existing documents if requested (optional query parameter)
        const query = getQuery(event);
        const clearExisting = query.clear === "true";

        if (clearExisting) {
          await db.sql`DELETE FROM documents`;
        }

        // Process documents one by one
        const embeddedDocuments = await Promise.all(
          documents.map(async (document) => {
            const embedding = await embeddingContext.getEmbeddingFor(
              document.content
            );
            return { ...document, embedding };
          })
        );

        const prepst = db.prepare(
          `insert into documents (content, metadata, embedding) values (?, jsonb(?), ?)`
        );

        for (const { content, metadata, embedding } of embeddedDocuments) {
          const { success } = await prepst.run(
            content,
            JSON.stringify(metadata),
            new Float32Array(embedding.vector) as unknown as Primitive
          );
          if (!success) {
            throw new Error("Failed to insert document");
          }
        }

        // Commit the transaction
        await db.sql`COMMIT`;

        return {
          message: `Successfully restored ${documents.length} documents`,
          cleared: clearExisting,
        };
      } catch (error) {
        // Rollback on error
        await db.sql`ROLLBACK`;
        throw error;
      }
    } catch (error) {
      console.error("Error restoring backup:", error);
      throw createError({
        statusCode: 500,
        statusMessage: "Internal Server Error",
        cause: error,
        message: "Failed to restore backup",
      });
    }
  });
});
