import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert";
import { Connector, createDatabase, Database, Primitive } from "db0";
import sqlite from "db0/connectors/better-sqlite3";
import { migration } from "../server/database/migrations/001-initialize-schema";
import { Database as BetterSqlite3Database } from "better-sqlite3";
import { load as sqliteVecLoad } from "sqlite-vec";

type Db = Database<Connector<BetterSqlite3Database>>;
// Mock AiContext for tests
class MockAiContext {
  async getEmbeddingFor(text: string) {
    // Return a fake embedding
    return {
      vector: new Array(1024).fill(0.25),
      text,
    };
  }

  async rankAll(query: string, texts: string[]) {
    // Return mock scores
    return texts.map((_, i) => 1.0 - i * 0.1);
  }
}

describe("API Compatibility Tests", () => {
  let db: Db;
  let mockEmbeddingContext;

  beforeEach(async () => {
    // Create a fresh in-memory database for each test
    db = createDatabase(sqlite({ name: ":memory:" }));
    sqliteVecLoad(await db.getInstance());

    // Apply migration
    await migration.up(db);

    // Create mock AI context
    mockEmbeddingContext = new MockAiContext();
  });

  after(async () => {
    if (db) {
      // DB0 does not support connection closing.
      //   await db.close();
    }
  });

  it("should handle documents with content field format", async () => {
    try {
      // Test document in the old format (content in root)
      const oldFormatDoc = {
        content: "This is a test document",
        metadata: { title: "Test" },
      };

      // Insert the document
      const docResult = await db.sql`
      INSERT INTO documents (data)
      VALUES (jsonb(${JSON.stringify(oldFormatDoc)}))
      RETURNING id
    `;

      const docId = docResult.rows[0].id;

      // Create the default index
      const indexResult = await db.sql`
    INSERT INTO indices (name, indexed_property_path, description)
      VALUES ('default', '$.content', 'Default index migrated from previous schema')
      RETURNING id
    `;
      const indexId = indexResult.rows[0].id;

      // Create an embedding
      const embedding = await mockEmbeddingContext.getEmbeddingFor(
        oldFormatDoc.content
      );

      // Insert the embedding
      await db.sql`
      INSERT INTO embeddings (document_id, index_id, vector)
      VALUES (CAST(${docId} as integer), CAST(${indexId} as integer), ${
        new Float32Array(embedding.vector) as unknown as Primitive
      })
    `;

      // Now test that we can search and retrieve this document
      // This would test the GET endpoint functionality

      // First, generate a query embedding
      const queryEmbedding = await mockEmbeddingContext.getEmbeddingFor(
        "test document"
      );

      // Search
      const searchResults = await db.sql`
      SELECT d.id, JSON(d.data) as data
      FROM documents d
      JOIN embeddings e ON d.id = e.document_id
      WHERE e.index_id = ${indexId}
      ORDER BY vec_distance_cosine(e.vector, ${
        new Float32Array(queryEmbedding.vector) as unknown as Primitive
      }) ASC
      LIMIT 5
    `;

      // Verify results
      assert.strictEqual(
        searchResults.rows.length,
        1,
        "should find the document"
      );

      // Extract content for reranking (simulating API endpoint behavior)
      const content = JSON.parse(String(searchResults.rows[0].data)).content;
      assert.strictEqual(
        content,
        "This is a test document",
        "should extract content correctly"
      );
    } catch (e) {
      console.error(e);
      throw e;
    }
  });

  it("should handle documents with nested content field", async () => {
    try {
      // Test document with nested content structure
      const nestedDoc = {
        details: {
          content: "This is a nested document",
          language: "en",
        },
      };

      // Insert the document
      const docResult = await db.sql`
      INSERT INTO documents (data)
      VALUES (jsonb(${JSON.stringify(nestedDoc)}))
      RETURNING id
    `;

      const docId = docResult.rows[0].id;

      // Create a custom index for the nested path
      const newIndexResult = await db.sql`
      INSERT INTO indices (name, indexed_property_path, description)
      VALUES ('nested_content', '$.details.content', 'Index for nested content field')
      RETURNING id
    `;

      const nestedIndexId = newIndexResult.rows[0].id;

      // Create an embedding for the nested content
      const embedding = await mockEmbeddingContext.getEmbeddingFor(
        nestedDoc.details.content
      );

      // Insert the embedding
      await db.sql`
      INSERT INTO embeddings (document_id, index_id, vector)
      VALUES (CAST(${docId} as integer), CAST(${nestedIndexId} as integer), ${
        new Float32Array(embedding.vector) as unknown as Primitive
      })
    `;

      // Search using the nested index
      const queryEmbedding = await mockEmbeddingContext.getEmbeddingFor(
        "nested document"
      );

      const searchResults = await db.sql`
      SELECT d.id, JSON(d.data) as data
      FROM documents d
      JOIN embeddings e ON d.id = e.document_id
      WHERE e.index_id = ${nestedIndexId}
      ORDER BY vec_distance_cosine(e.vector, ${
        new Float32Array(queryEmbedding.vector) as unknown as Primitive
      }) ASC
      LIMIT 5
    `;

      // Verify results
      assert.strictEqual(
        searchResults.rows.length,
        1,
        "should find the document"
      );

      // Extract nested content (simulating API endpoint behavior)
      const contentQuery = await db.sql`
      SELECT ${String(
        searchResults.rows[0].data
      )} ->> '$.details.content' as text_content
    `;

      assert.strictEqual(
        contentQuery.rows[0].text_content,
        "This is a nested document",
        "should extract nested content correctly"
      );
    } catch (e) {
      console.error(e);
      throw e;
    }
  });
});
