import { Primitive } from "db0";

export default defineLazyEventHandler(async () => {
  const db = await getDb();
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

    // Get requested indices
    const indicesQuery = await db.sql`
      SELECT id, name, indexed_property_path 
      FROM indices 
      WHERE name IN (${indices})
    `;
    
    if (!indicesQuery.rows.length) {
      throw createError({
        statusCode: 400,
        statusMessage: "Bad Request",
        message: "No valid indices specified",
      });
    }

    try {
      // Insert documents and their embeddings
      for (const document of documents) {
        // Insert the document
        const result = await db.sql`
          INSERT INTO documents (data) VALUES (${JSON.stringify(document)})
          RETURNING id
        `;
        
        if (!result || !result.rows.length) {
          throw new Error("Failed to insert document");
        }
        
        const documentId = result.rows[0].id;
        
        // Create embeddings for each index
        for (const idx of indicesQuery.rows) {
          // Extract the text to embed using the property path
          const textToEmbed = await db.sql`
            SELECT data ->> ${idx.indexed_property_path} as text_content
            FROM documents WHERE id = ${documentId}
          `;
          
          const content = textToEmbed.rows[0]?.text_content;
          
          if (content) {
            const embedding = await embeddingContext.getEmbeddingFor(content);
            
            // Insert embedding
            await db.sql`
              INSERT INTO embeddings (document_id, index_id, vector)
              VALUES (${documentId}, ${idx.id}, ${new Float32Array(embedding.vector) as unknown as Primitive})
            `;
          }
        }
      }
      
      return { success: true, count: documents.length };
      
    } catch (error) {
      console.error("Error inserting documents:", error);
      throw createError({
        statusCode: 500,
        statusMessage: "Internal Server Error",
        cause: error,
        message: "Failed to insert documents",
      });
    }
  });
});
