export default defineLazyEventHandler(async () => {
  const db = await getDb();

  return defineEventHandler(async (event) => {
    try {
      // Get all documents from the database
      const documents = await db.sql<{
        rows: Array<{ id: number; content: string; metadata: string }>;
      }>`
        SELECT id, content, json(metadata) metadata FROM documents
      `;

      // Process the documents to have proper metadata objects
      const processedDocuments = documents.rows.map((doc) => ({
        id: doc.id,
        content: doc.content,
        metadata: JSON.parse(doc.metadata),
      }));

      // Set response headers for file download
      setResponseHeaders(event, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="minivec-backup-${new Date()
          .toISOString()
          .replace(/:/g, "-")}.json"`,
      });

      return {
        documents: processedDocuments,
      };
    } catch (error) {
      console.error("Error creating backup:", error);
      throw createError({
        statusCode: 500,
        statusMessage: "Internal Server Error",
        cause: error,
        message: "Failed to create backup",
      });
    }
  });
});
