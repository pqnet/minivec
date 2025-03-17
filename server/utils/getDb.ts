import { getLoadablePath, load } from "sqlite-vec";
import type { Connector, Database } from "db0";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
let initialized = false;

export async function getDb() {
  const db: Database<Connector<BetterSqlite3Database>> = useDatabase();
  if (initialized) return db;
  
  // Create migrations table if it doesn't exist
  await db.sql`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  
  // Check if we need to migrate from the old schema
  const needsMigration = await checkIfOldSchemaExists(db);
  
  if (needsMigration) {
    await migrateFromOldSchema(db);
  } else {
    // Initialize schema if needed
    await initializeSchema(db);
  }
  
  initialized = true;
  return db;
}

async function checkIfOldSchemaExists(db) {
  try {
    // Check if the documents table exists with the old schema
    const tableInfo = await db.sql`PRAGMA table_info(documents)`;
    
    if (tableInfo.rows.length === 0) {
      // Table doesn't exist yet, no migration needed
      return false;
    }
    
    // Check if this is the old schema (has content, metadata, embedding columns)
    const hasOldColumns = tableInfo.rows.some(col => col.name === 'content') && 
                         tableInfo.rows.some(col => col.name === 'metadata') &&
                         tableInfo.rows.some(col => col.name === 'embedding');
    
    return hasOldColumns;
  } catch (error) {
    // If there's an error checking the schema, assume no migration needed
    console.error("Error checking schema:", error);
    return false;
  }
}

async function migrateFromOldSchema(db) {
  console.log("[Migration] Starting migration from old schema to multi-index schema");
  
  // Start transaction
  await db.sql`BEGIN TRANSACTION`;
  
  try {
    // Temporarily rename the old table
    await db.sql`ALTER TABLE documents RENAME TO documents_old`;
    
    // Create the new schema
    await initializeSchema(db);
    
    // Create the default index
    const indexResult = await db.sql`
      INSERT INTO indices (name, indexed_property_path, description)
      VALUES ('default', '$.content', 'Default index migrated from previous schema')
      RETURNING id
    `;
    
    if (!indexResult.rows.length) {
      throw new Error("Failed to create default index during migration");
    }
    
    const defaultIndexId = indexResult.rows[0].id;
    
    // Migrate the documents
    console.log("[Migration] Migrating documents and embeddings");
    const oldDocs = await db.sql`SELECT id, content, metadata, embedding FROM documents_old`;
    
    for (const doc of oldDocs.rows) {
      let metadata = {};
      try {
        // Parse the metadata JSON
        metadata = JSON.parse(doc.metadata);
      } catch (e) {
        console.warn(`[Migration] Warning: Failed to parse metadata for document ${doc.id}`);
      }
      
      // Create new document with content merged into metadata
      const newData = { content: doc.content, ...metadata };
      
      // Insert the document
      const newDoc = await db.sql`
        INSERT INTO documents (id, data)
        VALUES (${doc.id}, ${JSON.stringify(newData)})
      `;
      
      // Insert the embedding if it exists
      if (doc.embedding) {
        await db.sql`
          INSERT INTO embeddings (document_id, index_id, vector)
          VALUES (${doc.id}, ${defaultIndexId}, ${doc.embedding})
        `;
      }
    }
    
    // Drop the old table
    await db.sql`DROP TABLE documents_old`;
    
    // Record the migration
    await db.sql`
      INSERT INTO migrations (version, name)
      VALUES (1, 'migrate_to_multi_index_schema')
    `;
    
    console.log("[Migration] Migration completed successfully");
    await db.sql`COMMIT`;
  } catch (error) {
    // Rollback on failure
    await db.sql`ROLLBACK`;
    console.error("[Migration] Migration failed:", error);
    throw error;
  }
}

async function initializeSchema(db) {
  await db.sql`
    -- Create the core tables if they don't exist
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Table for index definitions
    CREATE TABLE IF NOT EXISTS indices (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL, 
      indexed_property_path TEXT NOT NULL,
      description TEXT
    );

    -- Virtual table for embeddings using sqlite-vec
    CREATE VIRTUAL TABLE IF NOT EXISTS embeddings USING vec0(
      id INTEGER PRIMARY KEY,
      document_id INTEGER NOT NULL,
      index_id INTEGER NOT NULL,
      vector VECTOR,
      FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY(index_id) REFERENCES indices(id) ON DELETE CASCADE
    );

    -- Create partitioned index on the embeddings
    CREATE INDEX IF NOT EXISTS idx_embeddings_by_index_id ON embeddings(index_id);
  `;
  
  // Check if initialization migration record exists
  const migrationExists = await db.sql`
    SELECT id FROM migrations WHERE name = 'initialize_multi_index_schema'
  `;
  
  if (!migrationExists.rows.length) {
    await db.sql`
      INSERT INTO migrations (version, name)
      VALUES (1, 'initialize_multi_index_schema')
    `;
  }
}

export default getDb;
