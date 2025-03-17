import type { Connector, Database } from "db0";
import type { Database as BetterSqlite3Database } from "better-sqlite3";

// Define Migration interface
export interface Migration {
  name: string;
  version: number;
  up: (db: Database<Connector<BetterSqlite3Database>>) => Promise<void>;
  down?: (db: Database<Connector<BetterSqlite3Database>>) => Promise<void>;
}

// List of migrations (imported lazily)
export const migrations = [
  () => import('./migrations/001-initialize-schema').then(m => m.migration),
  // Add more migrations as they are created
];

export async function migrate(db: Database<Connector<BetterSqlite3Database>>) {
  // Create migrations table if it doesn't exist
  await db.sql`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Get the currently applied migrations
  const appliedMigrations = await db.sql`
    SELECT version, name FROM migrations ORDER BY version ASC
  `;
  
  const appliedVersions = new Set(appliedMigrations.rows.map(m => m.version));
  
  // Apply pending migrations in order
  for (const getMigration of migrations) {
    const migration = await getMigration();
    
    if (!appliedVersions.has(migration.version)) {
      console.log(`[Migration] Applying migration: ${migration.name} (v${migration.version})`);
      
      // Start transaction
      await db.sql`BEGIN TRANSACTION`;
      
      try {
        // Run the migration
        await migration.up(db);
        
        // Record the migration
        await db.sql`
          INSERT INTO migrations (version, name)
          VALUES (${migration.version}, ${migration.name})
        `;
        
        await db.sql`COMMIT`;
        console.log(`[Migration] Successfully applied migration: ${migration.name}`);
      } catch (error) {
        // Rollback on failure
        await db.sql`ROLLBACK`;
        console.error(`[Migration] Failed to apply migration ${migration.name}:`, error);
        throw error;
      }
    }
  }
  
  console.log('[Migration] Database is up to date');
}