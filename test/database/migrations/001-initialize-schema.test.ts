import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert";
import { Connector, createDatabase, Database, Primitive } from "db0";
import sqlite from "db0/connectors/better-sqlite3";
import { migration } from "../../../server/database/migrations/001-initialize-schema";
import { Database as BetterSqlite3Database } from "better-sqlite3";
import { load as sqliteVecLoad } from "sqlite-vec";

const example_vec = new Float32Array(new Array(1024).map((_, i) => i % 256));

describe("Database Migrations", () => {
  // Test database initialization on empty database
  describe("Initialize Schema on Empty Database", () => {
    let db;

    beforeEach(async () => {
      // Create a fresh in-memory database for each test
      db = createDatabase(sqlite({ name: ":memory:" }));
      sqliteVecLoad(await db.getInstance());
    });

    after(async () => {
      // Clean up
      if (db) {
        // DB0 does not support connection closing.
        // await db.close();
      }
    });

    it("should create tables and default index", async () => {
      // Apply the migration
      await migration.up(db);

      // Verify documents table exists with correct schema
      const docTableInfo =
        await db.sql`select * from pragma_table_info('documents')`;
      assert.strictEqual(
        docTableInfo.rows.length > 0,
        true,
        "documents table should exist"
      );

      // Check for id and data columns
      const hasId = docTableInfo.rows.some((col) => col.name === "id");
      const hasData = docTableInfo.rows.some((col) => col.name === "data");
      assert.strictEqual(hasId, true, "documents table should have id column");
      assert.strictEqual(
        hasData,
        true,
        "documents table should have data column"
      );

      // Verify indices table exists with default index
      const indices =
        await db.sql`SELECT name, indexed_property_path FROM indices`;
      assert.strictEqual(indices.rows.length, 0, "should not create default index on empty database");

      // Verify embeddings table exists
      const embedTableExists = await db.sql`
        SELECT name FROM sqlite_master WHERE type='table' AND name='embeddings'
      `;
      assert.strictEqual(
        embedTableExists.rows.length,
        1,
        "embeddings table should exist"
      );
    });
  });

  // Test migration from old schema
  describe("Migration from Old Schema", () => {
    let db: Database<Connector<BetterSqlite3Database>>;

    beforeEach(async () => {
      // Create a fresh in-memory database for each test
      db = createDatabase(sqlite({ name: ":memory:" }));
      sqliteVecLoad(await db.getInstance());

      // Set up the old schema
      await db.sql`
        CREATE TABLE documents (
          id integer primary key autoincrement,
          content text not null,
          metadata text not null,
          embedding blob not null
        )
      `;

      // Insert some test data
      await db.sql`
        INSERT INTO documents (content, metadata, embedding)
        VALUES (
          'Test document content',
          '{"title": "Test Document", "tags": ["test", "document"]}',
          ${example_vec as unknown as Primitive}
        )
      `;
    });

    after(async () => {
      // Clean up
      if (db) {
        // DB0 does not support connection closing. We will have to leak the connection.
        // await db.close();
      }
    });

    it("should migrate data from old schema to new schema", async () => {
      // Apply the migration
      await migration.up(db);

      // Check that old table is gone
      const oldTableExists = await db.sql`
        SELECT name FROM sqlite_master WHERE type='table' AND name='documents_old'
      `;
      assert.strictEqual(
        oldTableExists.rows.length,
        0,
        "documents_old table should be removed"
      );

      // Verify the new tables exist
      const docTableInfo =
        await db.sql`select * from pragma_table_info('documents')`;
      assert.strictEqual(
        docTableInfo.rows.length > 0,
        true,
        "documents table should exist"
      );

      // Check that data was migrated
      const migratedDocs = await db.sql`SELECT json(data) as data FROM documents`;
      assert.strictEqual(
        migratedDocs.rows.length,
        1,
        "document should be migrated"
      );

      // Parse the JSON data and check structure
      const docData = JSON.parse(String(migratedDocs.rows[0].data));
      assert.strictEqual(
        docData.content,
        "Test document content",
        "content should be preserved"
      );
      assert.strictEqual(
        docData.title,
        "Test Document",
        "metadata fields should be merged"
      );
      assert.deepStrictEqual(
        docData.tags,
        ["test", "document"],
        "complex metadata should be preserved"
      );

      // Verify embeddings were migrated
      const embeddings = await db.sql`SELECT * FROM embeddings`;
      assert.strictEqual(
        embeddings.rows.length,
        1,
        "embedding should be migrated"
      );
    });

    it("should handle malformed metadata gracefully", async () => {
      // Insert document with invalid JSON metadata
      await db.sql`
        INSERT INTO documents (content, metadata, embedding)
        VALUES (
          'Document with bad metadata',
          'not valid json',
          ${example_vec as unknown as Primitive}
        )
      `;

      // Apply the migration
      await migration.up(db);

      // Check that both documents were migrated
      const migratedDocs = await db.sql`
        SELECT json(data) as data FROM documents ORDER BY id
      `;
      assert.strictEqual(
        migratedDocs.rows.length,
        2,
        "both documents should be migrated"
      );

      // Parse the JSON data of the second document
      const docData = JSON.parse(String(migratedDocs.rows[1].data));
      assert.strictEqual(
        docData.content,
        "Document with bad metadata",
        "content should be preserved"
      );
      assert.deepStrictEqual(
        Object.keys(docData).length,
        1,
        "no metadata fields should be merged when JSON is invalid"
      );
    });
  });
});
