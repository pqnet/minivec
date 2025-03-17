export default defineLazyEventHandler(async () => {
  const db = await getDb();
  
  return defineEventHandler(async (event) => {
    const method = getMethod(event);
    
    // GET - List all indices
    if (method === 'GET') {
      const indices = await db.sql`
        SELECT id, name, indexed_property_path, description
        FROM indices
        ORDER BY name
      `;
      
      return indices.rows;
    }
    
    // POST - Create a new index
    if (method === 'POST') {
      const { disableWrite } = useRuntimeConfig(event);
      if (disableWrite) {
        throw createError({
          statusCode: 403,
          statusMessage: "Forbidden",
          message: "Write operations are disabled",
        });
      }
      
      const { name, indexed_property_path, description } = await readBody(event);
      
      if (!name || !indexed_property_path) {
        throw createError({
          statusCode: 400,
          statusMessage: "Bad Request",
          message: "Name and indexed_property_path are required",
        });
      }
      
      try {
        const result = await db.sql`
          INSERT INTO indices (name, indexed_property_path, description)
          VALUES (${name}, ${indexed_property_path}, ${description || null})
          RETURNING id, name, indexed_property_path, description
        `;
        
        return result.rows[0];
      } catch (error) {
        if (error.message?.includes('UNIQUE constraint failed')) {
          throw createError({
            statusCode: 409,
            statusMessage: "Conflict",
            message: `Index with name "${name}" already exists`,
          });
        }
        
        throw createError({
          statusCode: 500,
          statusMessage: "Internal Server Error",
          message: "Failed to create index",
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