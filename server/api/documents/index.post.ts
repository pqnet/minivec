import { Primitive } from "db0";

export default defineLazyEventHandler(async () => {
  const db = await getDb();
  const { embeddingContext } = await useAiContext();
  return defineEventHandler(async (event) => {
    const { documents } = await readBody<{
      documents: { content: string; metadata: unknown }[];
    }>(event);
    if (!Array.isArray(documents) || documents.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "Bad Request",
        message: "No documents provided",
      });
    }

    const embeddedDocuments = await Promise.all(
      documents.map(async (document) => {
        const embedding = await embeddingContext.getEmbeddingFor(
          document.content
        );
        return { ...document, embedding };
      })
    );
    const prepst = db.prepare(
      `insert into documents (content, metadata, embedding) values ( ?, jsonb(?), ?)`
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
  });
});
