import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert";
import { createDatabase } from "db0";
import sqlite from "db0/connectors/better-sqlite3";
import { load as sqliteVecLoad } from "sqlite-vec";
import { migration } from "../server/database/migrations/001-initialize-schema";
import { createDatabaseService } from "../server/utils/DatabaseService";

describe("DatabaseService", () => {
  let db;
  let dbService;

  beforeEach(async () => {
    // Create a fresh in-memory database for each test
    db = createDatabase(sqlite({ name: ":memory:" }));
    sqliteVecLoad(await db.getInstance());

    // Apply migration
    await migration.up(db);

    // Create database service
    dbService = createDatabaseService(db);

    // Since the default index is no longer created automatically for fresh databases,
    // we need to create it for our tests
    await dbService.createIndex("default", "$.content", "Default index for tests");
  });

  describe("Index operations", () => {
    it("should list indices", async () => {
      const indices = await dbService.listIndices();
      assert.strictEqual(indices.length, 1, "should have default index");
      assert.strictEqual(indices[0].name, "default", "should be named 'default'");
    });

    it("should create new indices with valid paths", async () => {
      await dbService.createIndex("test-index", "$.test", "Test index description");

      const indices = await dbService.listIndices();
      assert.strictEqual(indices.length, 2, "should have two indices now");

      const testIndex = indices.find(idx => idx.name === "test-index");
      assert.ok(testIndex, "should find the new index");
      assert.strictEqual(testIndex.indexedPropertyPath, "$.test", "should have correct path");
    });

    it("should reject invalid property paths", async () => {
      try {
        await dbService.createIndex("invalid-index", "invalid-path", "Bad path");
        assert.fail("Should have rejected invalid path");
      } catch (error) {
        assert.ok(error.message.includes("Invalid property path"), "should have proper error message");
      }
    });
  });

  describe("Document operations", () => {
    it("should add documents and retrieve them by vector search", async () => {
      // Add a document
      const docId = await dbService.addDocument({ content: "Test content" });

      // Add an embedding for it
      const mockVector = new Array(1024).fill(0.1);
      const indexId = (await dbService.getIndexByName("default"))!.id;

      await dbService.addEmbeddings([{
        documentId: docId,
        indexId,
        vector: mockVector
      }]);

      // Search using the same vector
      const results = await dbService.searchDocumentsByVector(mockVector, "default");

      assert.strictEqual(results.length, 1, "should find one document");
      assert.strictEqual(results[0].id, docId, "should be the same document");
      assert.strictEqual(results[0].data.content, "Test content", "should have correct content");
    });

    it("should identify documents that need indexing", async () => {
      // Create a new index
      const newIndex = await dbService.createIndex("summary-index", "$.summary", "Summary index");

      // Add documents with both content and summary
      const docId1 = await dbService.addDocument({ content: "Content 1", summary: "Summary 1" });
      const docId2 = await dbService.addDocument({ content: "Content 2" }); // No summary
      const docId3 = await dbService.addDocument({ content: "Content 3", summary: "Summary 3" });

      // Only add embedding for first document
      await dbService.addEmbeddings([{
        documentId: docId1,
        indexId: newIndex!.id,
        vector: new Array(1024).fill(0.1)
      }]);

      // Check which documents need indexing for summary-index
      const docsNeedingIndexing = await dbService.getDocumentsForIndexing("summary-index");

      // Should only return doc3 (doc1 already has embedding, doc2 has no summary field)
      assert.strictEqual(docsNeedingIndexing.length, 1, "should find one document needing indexing");
      assert.strictEqual(docsNeedingIndexing[0].id, docId3, "should be the third document");
      assert.strictEqual(docsNeedingIndexing[0].textContent, "Summary 3", "should extract correct content");

      // check also the content index
      const docsNeedingIndexingContent = await dbService.getDocumentsForIndexing("default");
      assert.strictEqual(docsNeedingIndexingContent.length, 3, "should find three documents needing indexing");
      assert.strictEqual(docsNeedingIndexingContent[0].id, docId1, "should be the first document");
      assert.strictEqual(docsNeedingIndexingContent[1].id, docId2, "should be the second document");
      assert.strictEqual(docsNeedingIndexingContent[2].id, docId3, "should be the third document");
    });

    it('should find applicable indices for a document', async () => {
      // Create multiple indices
      await dbService.createIndex('content-index', '$.content', 'Content index');
      await dbService.createIndex('title-index', '$.title', 'Title index');
      await dbService.createIndex('nested-index', '$.details.text', 'Nested property index');

      // Add a document with multiple applicable fields
      const docId = await dbService.addDocument({
        content: 'Document content',
        title: 'Document title',
        details: {
          text: 'Nested text content',
          number: 42
        },
        tags: ['test', 'document']
      });

      // Find applicable indices by document ID
      const indicesById = await dbService.findApplicableIndices(docId);
      assert.strictEqual(indicesById.length, 3, 'Should find 3 applicable indices for document ID');

      const indexNames = indicesById.map(idx => idx.name).sort();
      assert.deepStrictEqual(indexNames, ['content-index', 'nested-index', 'title-index'].sort());

      // Find applicable indices by document object
      const docObject = {
        content: 'Another document',
        details: {
          text: 'More nested content'
        }
      };

      const indicesByObject = await dbService.findApplicableIndices(docObject);
      assert.strictEqual(indicesByObject.length, 2, 'Should find 2 applicable indices for document object');
      assert.ok(indicesByObject.some(idx => idx.name === 'content-index'), 'Should include content index');
      assert.ok(indicesByObject.some(idx => idx.name === 'nested-index'), 'Should include nested index');
      assert.ok(!indicesByObject.some(idx => idx.name === 'title-index'), 'Should not include title index');
    });
  });
});
