import { getLoadablePath, load } from "sqlite-vec";
import type { Connector, Database } from "db0";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
let initialized = false;

export async function getDb() {
  const db: Database<Connector<BetterSqlite3Database>> = useDatabase();
  if (initialized) return db;
  // Initialize schema if needed
  await db.sql`
    -- Enable the SQLite Vector extension
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

  // Create default index if it doesn't exist
  // TODO let's think whether we need this. Probably only if migrating from an older version
//   const defaultIndex = await db.sql`
//     SELECT id FROM indices WHERE name = 'default'
//   `;

//   if (!defaultIndex || defaultIndex.rows.length === 0) {
//     await db.sql`
//       INSERT INTO indices (name, indexed_property_path, description)
//       VALUES ('default', '$.content', 'Default index for document content')
//     `;
//   }

  return db;
}
export default getDb;
